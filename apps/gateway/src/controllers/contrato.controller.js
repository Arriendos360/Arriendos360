const { Op } = require('sequelize');

const {
    adjuntarInmueble,
    adjuntarInquilino,
    adjuntarInquilinosEInmuebles
} = require('../clientes/composicion');
const { reemitirContrasenaTemporal, usuarioPorId } = require('../clientes/identidad');
const { idsDePropietario, propioDe } = require('../clientes/inmuebles');
const { sequelize } = require('../config/database');
const {
    registrarContratoFinalizado,
    registrarContratoFormalizado
} = require('../eventos');
const Contrato = require('../models/Contrato');
const { ESTADO_CONTRATO_FINALIZADO, ROL_INQUILINO } = require('../models/constantes');
const { esUuid } = require('../models/uuid');

/**
 * Ni `Inquilino` ni `Inmueble` llegan ya por `include`: los compone el gateway
 * pidiéndoselos a ms-identidad y a ms-inmuebles. La forma de la respuesta es la
 * misma que producía Sequelize, así que el frontend no se entera. Ver
 * `clientes/composicion.js`.
 *
 * LA CONSECUENCIA MENOS OBVIA de que Inmuebles se haya ido es que la
 * autorización cambia de sitio. Antes se resolvía dentro de la consulta, con
 * `$Inmueble.id_propietario$` sobre un JOIN; ahora hay que preguntar primero
 * qué inmuebles son de quien pregunta y filtrar por esa lista. Son dos pasos
 * donde había uno, y el primero puede fallar — por eso `idsDePropietario`
 * propaga el error en vez de devolver una lista vacía: una lista vacía haría
 * que un propietario viera «no tienes contratos», que es creíble y falso.
 *
 * LO QUE CAMBIÓ EN EL PASO 5. Formalizar y finalizar ya no llaman a
 * ms-inmuebles: anotan un evento en la tabla de salida DENTRO de la misma
 * transacción que escribe el contrato, y el publicador lo entrega después. El
 * contrato y el anuncio del contrato vuelven a ser una sola operación atómica;
 * lo que queda fuera es el estado del inmueble, que converge en segundos. Ver
 * `src/eventos/` y `docs/adr/0011`.
 */

/** 502 con el formato de error del proyecto. Un servicio caído no es un 500 nuestro. */
const responderServicioCaido = (res, error, accion) => {
    console.error(`Error al ${accion}:`, error.message);
    return res.status(502).json({ mensaje: 'No se pudo contactar el servicio de inmuebles' });
};

/**
 * Un contrato es visible para el dueño del inmueble O para su inquilino.
 *
 * La disyunción se conserva tal cual: la pertenencia manda sobre el rol
 * declarado, que es lo que permite que quien es propietario e inquilino a la vez
 * no pierda la mitad de sus datos. Lo que cambia es de dónde sale la mitad
 * izquierda — antes de un JOIN, ahora de una lista de identificadores.
 */
const visiblePara = (sub, idsInmuebles) => ({
    [Op.or]: [{ id_inmueble: { [Op.in]: idsInmuebles } }, { id_inquilino: sub }]
});

/** ¿Es este usuario parte del contrato? Sobre el contrato ya compuesto. */
const esParte = (contrato, sub) => {
    const esDuenioInmueble = Boolean(contrato.Inmueble) && contrato.Inmueble.id_propietario === sub;
    return esDuenioInmueble || contrato.id_inquilino === sub;
};

// Obtener todos los contratos en los que el usuario es parte
const obtenerTodos = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const mios = await idsDePropietario(sub);

        const contratos = await Contrato.findAll({ where: visiblePara(sub, mios) });

        // Dos peticiones para toda la lista, no dos por fila.
        res.json(await adjuntarInquilinosEInmuebles(contratos));
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener contratos');
    }
};

// Obtener contrato por ID
const obtenerPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const contrato = esUuid(id) ? await Contrato.findByPk(id) : null;

        if (!contrato) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado' });
        }

        const compuesto = await adjuntarInquilino(await adjuntarInmueble(contrato));

        if (!esParte(compuesto, sub)) {
            return res.status(403).json({ mensaje: 'No tienes permisos para ver este contrato' });
        }

        res.json(compuesto);
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener contrato');
    }
};

const crear = async (req, res) => {
    let t = null;
    try {
        const { sub } = req.usuario;
        const { id_inmueble, id_inquilino, inicio, fin, canon } = req.body;

        // Las columnas de auditoría no se aceptan del cliente: las pone el hook.
        const { creado_por, actualizado_por, ...contratoData } = req.body;

        // 0. Verificar que el inmueble pertenece al propietario autenticado.
        //    Antes era un `findOne` con dos condiciones; ahora se le pide el
        //    inmueble a ms-inmuebles y se compara aquí. Que el `sub` no salga de
        //    este proceso es deliberado: el que autoriza es el gateway.
        //
        //    En su propio try/catch: un servicio caído es un 502, no un 500 con
        //    el mensaje interno dentro. Y sobre todo NO es un 403 — decirle a
        //    alguien «no tienes permisos» cuando en realidad no se ha podido
        //    comprobar es la peor de las tres respuestas.
        let inmueble = null;
        try {
            inmueble = esUuid(id_inmueble) ? await propioDe(id_inmueble, sub) : null;
        } catch (error) {
            return responderServicioCaido(res, error, 'verificar el inmueble');
        }

        if (!inmueble) {
            return res.status(403).json({ mensaje: 'No tienes permisos sobre este inmueble' });
        }

        // 1. Validaciones de Negocio
        if (new Date(fin) <= new Date(inicio)) {
            return res.status(400).json({ mensaje: 'La fecha de fin debe ser posterior a la de inicio' });
        }

        if (parseFloat(canon) <= 0) {
            return res.status(400).json({ mensaje: 'El canon debe ser un número positivo' });
        }

        // El día límite llega del formulario, así que se valida aquí y no sólo
        // en el modelo: la validación de Sequelize saldría por el `catch` de
        // abajo como un 500, y esto es un 400 de manual — un dato del cliente
        // que no vale. Sólo se mira si viene: si no, lo deriva el hook.
        if (contratoData.fecha_limite_pago !== undefined && contratoData.fecha_limite_pago !== '') {
            const dia = Number(contratoData.fecha_limite_pago);

            if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
                return res.status(400).json({
                    mensaje: 'La fecha límite de pago debe ser un día del mes (1-31)'
                });
            }

            // `multipart/form-data` lo entrega como cadena; la columna es entera.
            contratoData.fecha_limite_pago = dia;
        }

        // 2. Verificar que el inquilino existe y que efectivamente es inquilino.
        //    Un fallo de ms-identidad se traduce en «inquilino no encontrado»,
        //    que es lo prudente: ante la duda no se firma un contrato contra un
        //    usuario que quizá no exista o quizá no sea inquilino.
        const inquilino = esUuid(id_inquilino) ? await usuarioPorId(id_inquilino) : null;

        if (!inquilino || !(inquilino.roles || []).includes(ROL_INQUILINO)) {
            return res.status(404).json({
                mensaje: 'Inquilino no encontrado',
                error_code: 'TENANT_NOT_FOUND',
                id_inquilino
            });
        }

        // 3. Manejar archivos
        if (req.file) {
            contratoData.url_pdf = `/uploads/contratos/${req.file.filename}`;
        }

        // `fecha_inicio_corte` y `fecha_limite_pago` NO se calculan aquí: si no
        // vienen en el cuerpo, las deriva de `inicio` el hook del modelo, que es
        // donde vive el invariante porque las dos columnas son NOT NULL. Si
        // vienen —el formulario manda el día límite, editable— ganan las del
        // cuerpo. Ver `models/fechasContrato.js`.

        // 4. Guardar el contrato Y ANUNCIARLO, en una sola transacción.
        //
        //    Las dos escrituras van a la misma base, así que o quedan las dos o
        //    no queda ninguna. Esto es lo que devuelve la atomicidad que el
        //    ADR 0011 dio por perdida: no la del contrato con el estado del
        //    inmueble —eso ya no es posible ni deseable— sino la del contrato
        //    con el HECHO DE HABERLO ANUNCIADO, que es la que se puede tener y
        //    la que hace que el estado del inmueble acabe convergiendo.
        //
        //    Si el registro del evento falla, el contrato no se guarda. Es el
        //    orden correcto: un contrato que nadie anuncia deja el sistema
        //    inconsistente en silencio; un contrato que no se firma se le dice
        //    al usuario, que vuelve a intentarlo.
        t = await sequelize.transaction();
        const nuevoContrato = await Contrato.create(contratoData, {
            transaction: t,
            usuarioAuditor: sub
        });
        await registrarContratoFormalizado(nuevoContrato, t);
        await t.commit();
        t = null;

        // Ya no se llama a ms-inmuebles. El publicador entrega el evento y el
        // inmueble pasa a `arrendado` en cuestión de segundos; la respuesta no
        // espera a eso y tampoco necesita avisar de nada, porque no hay nada que
        // se pueda haber perdido.
        res.status(201).json({
            mensaje: 'Contrato creado exitosamente',
            contrato: nuevoContrato
        });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Error al crear contrato:', error);
        res.status(500).json({ mensaje: 'Error al crear contrato', error: error.message });
    }
};

/** El contrato, solo si es sobre un inmueble de `sub`. Null si no. */
const contratoPropio = async (id, sub) => {
    const contrato = esUuid(id) ? await Contrato.findByPk(id) : null;

    if (!contrato) {
        return null;
    }

    const inmueble = await propioDe(contrato.id_inmueble, sub);
    return inmueble ? contrato : null;
};

// Actualizar contrato
const actualizar = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const contrato = await contratoPropio(id, sub);

        if (!contrato) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado o no tienes permisos' });
        }

        const { creado_por, actualizado_por, ...cambios } = req.body;

        await contrato.update(cambios, { usuarioAuditor: sub });
        res.json({ mensaje: 'Contrato actualizado', contrato });
    } catch (error) {
        return responderServicioCaido(res, error, 'actualizar contrato');
    }
};

// Finalizar contrato
const finalizar = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const contrato = await contratoPropio(id, sub);

        if (!contrato) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado o no tienes permisos' });
        }

        // Estado finalizado y anuncio, en la misma transacción. Antes esto no
        // tenía transacción porque era una sola fila; ahora son dos, y son
        // justamente las dos que no pueden quedar desparejadas.
        await sequelize.transaction(async (transaccion) => {
            await contrato.update(
                { estado: ESTADO_CONTRATO_FINALIZADO },
                { transaction: transaccion, usuarioAuditor: sub }
            );
            await registrarContratoFinalizado(contrato, transaccion);
        });

        // La liberación del inmueble la hace ms-inmuebles al consumir el evento.
        res.json({ mensaje: 'Contrato finalizado', contrato });
    } catch (error) {
        console.error('Error al finalizar contrato:', error.message);
        res.status(500).json({ mensaje: 'Error al finalizar contrato', error: error.message });
    }
};

/**
 * POST /api/contratos/:id/contrasena-inquilino
 *
 * Regenera la contrasena temporal del inquilino de un contrato y la devuelve una
 * sola vez, para que el propietario se la entregue. Existe porque la temporal
 * del alta se muestra una vez y no se puede volver a consultar: si se pierde
 * antes de entregarla, hasta ahora no habia forma de generar otra.
 *
 * POR QUE VIVE AQUI Y NO EN ms-identidad. La regla de autorizacion es «solo
 * sobre inquilinos con contrato en mis inmuebles», y eso son datos de contratos
 * e inmuebles. Ms-identidad es subdominio de Soporte: si tuviera que
 * comprobarlo, dependeria de un servicio de dominio e invertiria la direccion de
 * las dependencias. Ver docs/adr/0010.
 *
 * Desde el paso 4 el ABAC ya no es una consulta local: el inmueble esta en otro
 * servicio, asi que son dos saltos. Sigue siendo el gateway quien decide.
 *
 * La ruta cuelga del contrato a proposito: el contrato ES lo que autoriza.
 */
const reemitirContrasenaDelInquilino = async (req, res) => {
    let contrato;
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        // ABAC de pertenencia (regla dura 8): el contrato tiene que ser sobre un
        // inmueble de quien pide. Se responde 404 y no 403 para no confirmar que
        // el contrato existe.
        contrato = await contratoPropio(id, sub);

        if (!contrato) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado o no tienes permisos' });
        }
    } catch (error) {
        return responderServicioCaido(res, error, 'verificar el contrato');
    }

    try {
        const resultado = await reemitirContrasenaTemporal(contrato.id_inquilino, req.usuario.sub);

        return res.json({
            mensaje: 'Contraseña temporal regenerada',
            // Unica vez que viaja en claro, igual que en el alta. No se guarda,
            // no se registra y no hay forma de volver a consultarla.
            contrasena_temporal: resultado.contrasena_temporal,
            inquilino: resultado.usuario
        });
    } catch (error) {
        console.error('Error al reemitir la contraseña del inquilino:', error.message);
        return res.status(502).json({ mensaje: 'No se pudo regenerar la contraseña temporal' });
    }
};

module.exports = {
    obtenerTodos,
    obtenerPorId,
    crear,
    actualizar,
    finalizar,
    reemitirContrasenaDelInquilino
};
