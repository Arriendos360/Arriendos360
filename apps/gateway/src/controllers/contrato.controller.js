const { Op } = require('sequelize');

const {
    adjuntarInmueble,
    adjuntarInquilino,
    adjuntarInquilinosEInmuebles
} = require('../clientes/composicion');
const { reemitirContrasenaTemporal, usuarioPorId } = require('../clientes/identidad');
const {
    ESTADO_ARRENDADO,
    ESTADO_DISPONIBLE,
    cambiarEstado,
    idsDePropietario,
    propioDe
} = require('../clientes/inmuebles');
const { sequelize } = require('../config/database');
const Contrato = require('../models/Contrato');
const { ROL_INQUILINO } = require('../models/constantes');
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
        const { id_inmueble, id_inquilino, fecha_inicio, fecha_fin, valor_mensual } = req.body;

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
        if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
            return res.status(400).json({ mensaje: 'La fecha de fin debe ser posterior a la de inicio' });
        }

        if (parseFloat(valor_mensual) <= 0) {
            return res.status(400).json({ mensaje: 'El valor mensual debe ser un número positivo' });
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

        if (typeof contratoData.inventario_fotografico === 'string') {
            try {
                contratoData.inventario_fotografico = JSON.parse(contratoData.inventario_fotografico);
            } catch (e) {
                contratoData.inventario_fotografico = [];
            }
        }

        // 4. Guardar el contrato. La transacción ya solo cubre esto, que es lo
        //    único que sigue siendo del gateway.
        t = await sequelize.transaction();
        const nuevoContrato = await Contrato.create(contratoData, {
            transaction: t,
            usuarioAuditor: sub
        });
        await t.commit();
        t = null;

        // 5. Y DESPUÉS, marcar el inmueble como arrendado.
        //
        //    Aquí se pierde la atomicidad, y no se finge lo contrario. El orden
        //    es «primero el hecho, después el reflejo»: al revés, un fallo
        //    dejaría un inmueble marcado como arrendado sin contrato detrás, que
        //    es la inconsistencia más difícil de detectar de las dos.
        //
        //    Si esto falla, el contrato SIGUE CREADO y la respuesta lo dice. Un
        //    500 sería mentir; callarlo sería peor. Ver docs/adr/0011.
        try {
            await cambiarEstado(id_inmueble, ESTADO_ARRENDADO, sub);
        } catch (error) {
            console.error(
                `⚠️  Contrato ${nuevoContrato.id_contrato} creado, pero el inmueble ` +
                    `${id_inmueble} NO se pudo marcar como arrendado:`,
                error.message
            );

            return res.status(201).json({
                mensaje: 'Contrato creado exitosamente',
                contrato: nuevoContrato,
                aviso: 'El contrato quedó registrado, pero el estado del inmueble no pudo actualizarse. Revísalo en la pantalla de Inmuebles.'
            });
        }

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

        // Cambiar estado a finalizado (2). Sin transacción: es una sola fila.
        await contrato.update({ estado: 2 }, { usuarioAuditor: sub });

        // Y liberar el inmueble, con el mismo tratamiento que al crear.
        try {
            await cambiarEstado(contrato.id_inmueble, ESTADO_DISPONIBLE, sub);
        } catch (error) {
            console.error(
                `⚠️  Contrato ${contrato.id_contrato} finalizado, pero el inmueble ` +
                    `${contrato.id_inmueble} NO se pudo liberar:`,
                error.message
            );

            return res.json({
                mensaje: 'Contrato finalizado',
                contrato,
                aviso: 'El contrato quedó finalizado, pero el inmueble sigue marcado como arrendado. Revísalo en la pantalla de Inmuebles.'
            });
        }

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
