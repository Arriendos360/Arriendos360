const { Op } = require('sequelize');

const { adjuntarInquilino, adjuntarInquilinos } = require('../clientes/composicion');
const { reemitirContrasenaTemporal, usuarioPorId } = require('../clientes/identidad');
const { sequelize } = require('../config/database');
const Contrato = require('../models/Contrato');
const Inmueble = require('../models/Inmueble');
const { ROL_INQUILINO } = require('../models/constantes');
const { esUuid } = require('../models/uuid');

/**
 * `Inquilino` ya no llega por `include`: lo compone el gateway pidiéndoselo a
 * ms-identidad. La forma de la respuesta es la misma que producía Sequelize, así
 * que el frontend no se entera. Ver `clientes/composicion.js`.
 */

/**
 * Un contrato es visible para el dueño del inmueble O para su inquilino.
 *
 * Antes esto era un if/else sobre el rol único del token. Con `roles` como
 * arreglo un usuario puede ser las dos cosas a la vez, así que la condición pasa
 * a ser una disyunción sobre la pertenencia real del recurso, no sobre el rol
 * declarado. Para un usuario de un solo rol el resultado es idéntico al
 * anterior: nadie figura como inquilino de un contrato sin serlo.
 */
const visiblePara = (sub) => ({
    [Op.or]: [{ '$Inmueble.id_propietario$': sub }, { id_inquilino: sub }]
});

// Obtener todos los contratos en los que el usuario es parte
const obtenerTodos = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const contratos = await Contrato.findAll({
            where: visiblePara(sub),
            include: [{ model: Inmueble, required: true }]
        });

        // Una sola petición a ms-identidad para toda la lista, no una por fila.
        res.json(await adjuntarInquilinos(contratos));
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener contratos', error: error.message });
    }
};

// Obtener contrato por ID
const obtenerPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const contrato = esUuid(id)
            ? await Contrato.findByPk(id, { include: [{ model: Inmueble }] })
            : null;

        if (!contrato) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado' });
        }

        const esDuenioInmueble = contrato.Inmueble && contrato.Inmueble.id_propietario === sub;
        const esInquilinoContrato = contrato.id_inquilino === sub;

        if (!esDuenioInmueble && !esInquilinoContrato) {
            return res.status(403).json({ mensaje: 'No tienes permisos para ver este contrato' });
        }

        res.json(await adjuntarInquilino(contrato));
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener contrato', error: error.message });
    }
};

const crear = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { sub } = req.usuario;
        const { id_inmueble, id_inquilino, fecha_inicio, fecha_fin, valor_mensual } = req.body;

        // Las columnas de auditoría no se aceptan del cliente: las pone el hook.
        const { creado_por, actualizado_por, ...contratoData } = req.body;

        // 0. Verificar que el inmueble pertenece al propietario autenticado
        const inmueble = await Inmueble.findOne({
            where: {
                id_inmueble: id_inmueble,
                id_propietario: sub
            }
        });

        if (!inmueble) {
            await t.rollback();
            return res.status(403).json({ mensaje: 'No tienes permisos sobre este inmueble' });
        }

        // 1. Validaciones de Negocio
        if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
            await t.rollback();
            return res.status(400).json({ mensaje: 'La fecha de fin debe ser posterior a la de inicio' });
        }

        if (parseFloat(valor_mensual) <= 0) {
            await t.rollback();
            return res.status(400).json({ mensaje: 'El valor mensual debe ser un número positivo' });
        }

        // 2. Verificar que el inquilino existe y que efectivamente es inquilino.
        //    Antes era un SELECT sobre `roles_usuario`; ahora esa tabla es de
        //    ms-identidad y hay que preguntárselo. El código de error se conserva
        //    porque el frontend lo usa para abrir el modal de alta cuando la
        //    persona todavía no está registrada.
        //
        //    Un fallo de ms-identidad se traduce en «inquilino no encontrado», que
        //    es lo prudente: ante la duda no se firma un contrato contra un
        //    usuario que quizá no exista o quizá no sea inquilino.
        const inquilino = esUuid(id_inquilino) ? await usuarioPorId(id_inquilino) : null;

        if (!inquilino || !(inquilino.roles || []).includes(ROL_INQUILINO)) {
            await t.rollback();
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

        const nuevoContrato = await Contrato.create(contratoData, {
            transaction: t,
            usuarioAuditor: sub
        });

        // 4. Actualizar estado del inmueble
        await Inmueble.update(
            { estado_ocupacion: 'arrendado' },
            {
                where: { id_inmueble: id_inmueble },
                transaction: t,
                usuarioAuditor: sub
            }
        );

        await t.commit();
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

// Actualizar contrato
const actualizar = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const contrato = esUuid(id)
            ? await Contrato.findByPk(id, { include: [{ model: Inmueble }] })
            : null;

        if (!contrato || !contrato.Inmueble || contrato.Inmueble.id_propietario !== sub) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado o no tienes permisos' });
        }

        const { creado_por, actualizado_por, ...cambios } = req.body;

        await contrato.update(cambios, { usuarioAuditor: sub });
        res.json({ mensaje: 'Contrato actualizado', contrato });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar contrato', error: error.message });
    }
};

// Finalizar contrato
const finalizar = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const contrato = esUuid(id)
            ? await Contrato.findByPk(id, { include: [{ model: Inmueble }] })
            : null;

        if (!contrato || !contrato.Inmueble || contrato.Inmueble.id_propietario !== sub) {
            await t.rollback();
            return res.status(404).json({ mensaje: 'Contrato no encontrado o no tienes permisos' });
        }

        // Cambiar estado a finalizado (2)
        await contrato.update({ estado: 2 }, { transaction: t, usuarioAuditor: sub });

        // Liberar inmueble
        await Inmueble.update(
            { estado_ocupacion: 'disponible' },
            {
                where: { id_inmueble: contrato.id_inmueble },
                transaction: t,
                usuarioAuditor: sub
            }
        );

        await t.commit();
        res.json({ mensaje: 'Contrato finalizado', contrato });
    } catch (error) {
        await t.rollback();
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
 * e inmuebles, que son del gateway. Ms-identidad es subdominio de Soporte: si
 * tuviera que comprobarlo, dependeria de un servicio de dominio e invertiria la
 * direccion de las dependencias. Aqui el ABAC es una consulta local y trivial, y
 * la regeneracion en si se delega por HTTP. Ver docs/adr/0010.
 *
 * La ruta cuelga del contrato a proposito: el contrato ES lo que autoriza.
 */
const reemitirContrasenaDelInquilino = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const contrato = esUuid(id)
            ? await Contrato.findByPk(id, { include: [{ model: Inmueble }] })
            : null;

        // ABAC de pertenencia (regla dura 8): el contrato tiene que ser sobre un
        // inmueble de quien pide. Se responde 404 y no 403 para no confirmar que
        // el contrato existe.
        if (!contrato || !contrato.Inmueble || contrato.Inmueble.id_propietario !== sub) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado o no tienes permisos' });
        }

        const resultado = await reemitirContrasenaTemporal(contrato.id_inquilino, sub);

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
