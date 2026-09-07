const { Op } = require('sequelize');
const PDFDocument = require('pdfkit');

const { adjuntarInquilino } = require('../clientes/composicion');
const { Pago, Contrato, Inmueble, Abono } = require('../models');
const { esUuid } = require('../models/uuid');
const { generarPDFComprobante } = require('../services/pdfService');

/**
 * Pagos y abonos.
 *
 * Dos cambios estructurales respecto a la versión anterior, ambos consecuencia
 * del nuevo modelo de identidad:
 *
 * 1. `id_perfil` (la cédula del perfil) desaparece y su papel lo hace el `sub`
 *    del token, que es el UUID del usuario.
 * 2. Los datos del arrendatario que imprimen los PDF ya no vienen de un
 *    `include`: `usuarios` es de ms-identidad y el JOIN cruzaría la frontera.
 *    Los pide el gateway por HTTP y los compone justo antes de generar el
 *    documento (`clientes/composicion.js`).
 *
 * La visibilidad deja de decidirse por el rol declarado y pasa a decidirse por
 * la pertenencia real: se ve un pago si eres el dueño del inmueble O el
 * inquilino del contrato. Para usuarios de un solo rol el resultado no cambia;
 * para quien es las dos cosas a la vez, que el modelo canónico ahora permite,
 * ya no se pierde la mitad de sus datos.
 */

// Rutas de columna a través de los `include`. Sequelize resuelve `$a.b.c$`
// contra los alias de la consulta, lo que permite poner la condición OR en el
// nivel superior en vez de repartirla por los `where` anidados.
const RUTA_PROPIETARIO_DESDE_PAGO = '$Contrato.Inmueble.id_propietario$';
const RUTA_INQUILINO_DESDE_PAGO = '$Contrato.id_inquilino$';
const RUTA_PROPIETARIO_DESDE_ABONO = '$Pago.Contrato.Inmueble.id_propietario$';
const RUTA_INQUILINO_DESDE_ABONO = '$Pago.Contrato.id_inquilino$';

const esParteDelPago = (sub) => ({
    [Op.or]: [{ [RUTA_PROPIETARIO_DESDE_PAGO]: sub }, { [RUTA_INQUILINO_DESDE_PAGO]: sub }]
});

const esParteDelAbono = (sub) => ({
    [Op.or]: [{ [RUTA_PROPIETARIO_DESDE_ABONO]: sub }, { [RUTA_INQUILINO_DESDE_ABONO]: sub }]
});

/** Contrato con su inmueble, como INNER JOIN: sin ellos no hay a quién autorizar. */
const contratoConInmueble = {
    model: Contrato,
    required: true,
    include: [{ model: Inmueble, required: true }]
};

/**
 * Contrato con su inmueble, para los PDF.
 *
 * Ya no incluye al propietario: los comprobantes nunca imprimieron sus datos, y
 * cargarlos era trabajo que no llegaba a ninguna parte. El arrendatario sí hace
 * falta y se compone aparte, porque vive en ms-identidad.
 *
 * Se distingue de `contratoConInmueble` en que ese es un INNER JOIN: sirve para
 * autorizar y por eso exige que el contrato y el inmueble existan. Éste no.
 */
const contratoParaPdf = {
    model: Contrato,
    include: [{ model: Inmueble }]
};

/** ¿Es este usuario parte del contrato al que pertenece el pago? */
const puedeVerPago = (pago, sub) => {
    const contrato = pago.Contrato;
    if (!contrato) {
        return false;
    }

    const esDuenio = contrato.Inmueble && contrato.Inmueble.id_propietario === sub;
    const esInquilino = contrato.id_inquilino === sub;

    return esDuenio || esInquilino;
};

// Obtener todos los pagos en los que el usuario es parte
const obtenerTodos = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const pagos = await Pago.findAll({
            where: esParteDelPago(sub),
            include: [contratoConInmueble]
        });
        res.json(pagos);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener pagos', error: error.message });
    }
};

// Obtener pagos por contrato
const obtenerPorContrato = async (req, res) => {
    try {
        const { id_contrato } = req.params;
        const { sub } = req.usuario;

        const contrato = esUuid(id_contrato)
            ? await Contrato.findOne({
                where: { id_contrato },
                include: [{ model: Inmueble }]
            })
            : null;

        if (!contrato) return res.status(404).json({ mensaje: 'Contrato no encontrado' });

        const esDuenio = contrato.Inmueble && contrato.Inmueble.id_propietario === sub;
        const esInquilino = contrato.id_inquilino === sub;

        if (!esDuenio && !esInquilino) {
            return res.status(403).json({ mensaje: 'No tienes permisos para ver los pagos de este contrato' });
        }

        const pagos = await Pago.findAll({
            where: { id_contrato },
            order: [['mes_correspondiente', 'ASC']]
        });
        res.json(pagos);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener pagos', error: error.message });
    }
};

// Crear pago
const crear = async (req, res) => {
    try {
        const { sub } = req.usuario;
        const { id_contrato, monto_total } = req.body;

        const contrato = esUuid(id_contrato)
            ? await Contrato.findOne({
                where: { id_contrato },
                include: [{ model: Inmueble, required: true, where: { id_propietario: sub } }]
            })
            : null;

        if (!contrato) return res.status(403).json({ mensaje: 'No tienes permisos sobre este contrato' });

        const { creado_por, actualizado_por, ...datos } = req.body;

        const nuevoPago = await Pago.create(
            { ...datos, saldo_pendiente: monto_total },
            { usuarioAuditor: sub }
        );
        res.status(201).json({ mensaje: 'Pago registrado exitosamente', pago: nuevoPago });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear pago', error: error.message });
    }
};

// Registrar abono - RF-17
const registrarPago = async (req, res) => {
    const { id } = req.params;
    const { sub } = req.usuario;
    const { monto_pagado, tipo_transaccion, observaciones } = req.body;
    const t = await Pago.sequelize.transaction();
    try {
        const pago = esUuid(id)
            ? await Pago.findByPk(id, { include: [contratoConInmueble], transaction: t })
            : null;
        if (!pago) { await t.rollback(); return res.status(404).json({ mensaje: 'Pago no encontrado' }); }

        if (parseFloat(monto_pagado) <= 0 || parseFloat(monto_pagado) > parseFloat(pago.saldo_pendiente)) {
            await t.rollback(); return res.status(400).json({ mensaje: 'Monto inválido o superior al saldo' });
        }

        if (!puedeVerPago(pago, sub)) { await t.rollback(); return res.status(403).json({ mensaje: 'No autorizado' }); }

        const nuevoSaldo = parseFloat(pago.saldo_pendiente) - parseFloat(monto_pagado);
        const nuevoAbono = await Abono.create(
            { id_pago: pago.id_pago, monto: monto_pagado, tipo_transaccion, observaciones, saldo_restante_momento: nuevoSaldo },
            { transaction: t, usuarioAuditor: sub }
        );

        let nuevoEstado = nuevoSaldo === 0 ? 2 : (pago.estado === 3 ? 3 : 4);
        await pago.update(
            { fecha_pago: new Date(), saldo_pendiente: nuevoSaldo, estado: nuevoEstado, tipo_transaccion, observaciones },
            { transaction: t, usuarioAuditor: sub }
        );

        await t.commit();
        res.json({ mensaje: nuevoSaldo === 0 ? 'Pago completado exitosamente' : 'Abono registrado exitosamente', pago, abono: nuevoAbono });
    } catch (error) { await t.rollback(); res.status(500).json({ mensaje: 'Error', error: error.message }); }
};

// Obtener historial global de abonos
const obtenerHistorialGlobalAbonos = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const abonos = await Abono.findAll({
            where: esParteDelAbono(sub),
            include: [{ model: Pago, required: true, include: [contratoConInmueble] }],
            order: [['fecha_abono', 'DESC']]
        });
        res.json(abonos);
    } catch (error) { res.status(500).json({ mensaje: 'Error al obtener historial global', error: error.message }); }
};

// Formateador de moneda
const fmt = (v) => `$ ${parseFloat(v || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;

// Formateador de periodo (Ej: Junio 2026)
const fmtPeriodo = (date) => new Date(date).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).replace(/^\w/, (c) => c.toUpperCase());

/**
 * Datos comunes de la cabecera de los comprobantes.
 *
 * El `arrendatario` lo compone el gateway pidiéndoselo a ms-identidad; su cédula
 * sale de `documento`. Lo que se imprime en el PDF es idéntico a antes.
 */
const datosEmpresa = {
    empresa_nombre: "ARRIENDOS 360 S.A.S",
    empresa_nit: "900.123.456-7",
    empresa_telefono: "+57 (601) 321 0000",
    empresa_email: "soporte@arriendos360.com",
    empresa_ciudad: "Bogotá D.C."
};

/**
 * Bloque del arrendatario.
 *
 * Tolera que falte: si ms-identidad no respondió, el recibo sale con «No
 * disponible» en lugar de no salir. Un comprobante incompleto sirve para algo;
 * un 500 al pedir el recibo, no.
 */
const datosArrendatario = (arrendatario) => ({
    nombre_arrendatario: arrendatario
        ? `${arrendatario.nombres} ${arrendatario.apellidos}`
        : 'No disponible',
    cedula_arrendatario: arrendatario ? arrendatario.documento : 'No disponible',
    telefono_arrendatario: (arrendatario && arrendatario.telefono) || 'No registrado',
    email_arrendatario: (arrendatario && arrendatario.email) || 'No registrado'
});

const datosInmueble = (inmueble) => ({
    direccion_inmueble: inmueble.direccion,
    barrio_ciudad: `${inmueble.barrio}, ${inmueble.municipio}`,
    tipo_inmueble: inmueble.tipo_inmueble
});

/** Envía un PDF ya construido con el mismo encabezado que usaba `window.open`. */
const responderPdf = (res, nombreArchivo, data) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
    doc.pipe(res);
    generarPDFComprobante(doc, data);
    doc.end();
};

// Generar comprobante abono - RF-18 (Versión PDF Estilizada)
const generarComprobanteAbono = async (req, res) => {
    try {
        const { id_abono } = req.params;
        const { sub } = req.usuario;

        const abono = esUuid(id_abono)
            ? await Abono.findByPk(id_abono, {
                include: [{ model: Pago, include: [contratoParaPdf] }]
            })
            : null;

        if (!abono) return res.status(404).json({ mensaje: 'No encontrado' });

        if (!abono.Pago || !puedeVerPago(abono.Pago, sub)) {
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        const contrato = await adjuntarInquilino(abono.Pago.Contrato);
        const arrendatario = contrato.Inquilino;
        const esTotal = parseFloat(abono.saldo_restante_momento) === 0;
        const periodo = fmtPeriodo(abono.Pago.mes_correspondiente);

        responderPdf(res, `Comprobante_${id_abono}.pdf`, {
            ...datosEmpresa,
            ...datosArrendatario(arrendatario),
            ...datosInmueble(contrato.Inmueble),
            numero_comprobante: `TRX-${abono.id_abono}`,
            fecha_expedicion: new Date(abono.fecha_abono).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }),
            estado_pago: esTotal ? 'PAGADO' : 'ABONO PARCIAL',
            periodo: periodo,
            concepto: esTotal ? `Pago de arriendo periodo ${periodo}` : `Abono arriendo periodo ${periodo}`,
            canon_mensual: fmt(abono.Pago.monto_total),
            valor_pagado: fmt(abono.monto),
            saldo_anterior: fmt(parseFloat(abono.saldo_restante_momento) + parseFloat(abono.monto)),
            saldo_pendiente: fmt(abono.saldo_restante_momento),
            forma_pago: abono.tipo_transaccion || 'Transferencia Bancaria',
            banco: 'Red Bancaria Nacional',
            referencia_pago: abono.observaciones || `Abono No. ${abono.id_abono}`
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al generar PDF', error: error.message });
    }
};

// Generar recibo de pago mensual base (Resumen del mes)
const generarRecibo = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const pago = esUuid(id)
            ? await Pago.findByPk(id, { include: [contratoParaPdf] })
            : null;

        if (!pago) return res.status(404).json({ mensaje: 'No encontrado' });

        if (!puedeVerPago(pago, sub)) {
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        const contrato = await adjuntarInquilino(pago.Contrato);
        const arrendatario = contrato.Inquilino;
        const esTotal = parseFloat(pago.saldo_pendiente) === 0;
        const periodo = fmtPeriodo(pago.mes_correspondiente);

        responderPdf(res, `Recibo_Mensual_${id}.pdf`, {
            ...datosEmpresa,
            ...datosArrendatario(arrendatario),
            ...datosInmueble(contrato.Inmueble),
            numero_comprobante: `REC-${pago.id_pago}`,
            fecha_expedicion: new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }),
            estado_pago: { 1: 'PENDIENTE', 2: 'PAGADO', 3: 'EN MORA', 4: 'PAGO PARCIAL' }[pago.estado],
            periodo: periodo,
            concepto: esTotal ? `Pago de arriendo periodo ${periodo}` : `Abono arriendo periodo ${periodo}`,
            canon_mensual: fmt(pago.monto_total),
            valor_pagado: fmt(parseFloat(pago.monto_total) - parseFloat(pago.saldo_pendiente)),
            saldo_anterior: fmt(pago.monto_total),
            saldo_pendiente: fmt(pago.saldo_pendiente),
            forma_pago: pago.tipo_transaccion || 'Múltiple',
            banco: 'N/A',
            referencia_pago: `Recibo mensual No. ${pago.id_pago}`
        });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al generar PDF', error: error.message });
    }
};

const obtenerPendientes = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const pagos = await Pago.findAll({
            where: {
                [Op.and]: [{ estado: { [Op.in]: [1, 4] } }, esParteDelPago(sub)]
            },
            include: [contratoConInmueble],
            order: [['mes_correspondiente', 'ASC']]
        });
        res.json(pagos);
    } catch (error) { res.status(500).json({ mensaje: 'Error', error: error.message }); }
};

const verificarMora = async (req, res) => {
    try {
        const { sub } = req.usuario;
        const hoy = new Date();
        const pagosVencidos = await Pago.findAll({
            where: { estado: { [Op.in]: [1, 4] }, mes_correspondiente: { [Op.lt]: hoy } },
            include: [{ model: Contrato, required: true, include: [{ model: Inmueble, required: true, where: { id_propietario: sub } }] }]
        });
        for (const pago of pagosVencidos) { await pago.update({ estado: 3 }, { usuarioAuditor: sub }); }
        res.json({ mensaje: 'Mora verificada', pagos_actualizados: pagosVencidos.length });
    } catch (error) { res.status(500).json({ mensaje: 'Error', error: error.message }); }
};

const obtenerAbonos = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;
        const pago = esUuid(id)
            ? await Pago.findByPk(id, { include: [contratoConInmueble] })
            : null;
        if (!pago) return res.status(404).json({ mensaje: 'No encontrado' });
        if (!puedeVerPago(pago, sub)) return res.status(403).json({ mensaje: 'No autorizado' });
        const abonos = await Abono.findAll({ where: { id_pago: id }, order: [['fecha_abono', 'DESC']] });
        res.json(abonos);
    } catch (error) { res.status(500).json({ mensaje: 'Error al obtener abonos', error: error.message }); }
};

module.exports = {
    obtenerTodos, obtenerPorContrato, crear, registrarPago, obtenerPendientes,
    verificarMora, generarRecibo, obtenerAbonos, generarComprobanteAbono, obtenerHistorialGlobalAbonos
};
