const { Sequelize, Op } = require('sequelize');
const { Pago, Contrato, Inmueble, Abono, Inquilino, Propietario, Usuario } = require('../models');
const { generarPDFComprobante } = require('../services/pdfService');
const PDFDocument = require('pdfkit');

// Obtener todos los pagos (Filtrados por propiedad/perfil)
const obtenerTodos = async (req, res) => {
    try {
        const { rol, id_perfil } = req.usuario;
        
        const filter = {
            include: [{ 
                model: Contrato,
                required: true,
                include: [{
                    model: Inmueble,
                    required: true
                }]
            }]
        };

        if (rol === 'propietario') {
            filter.include[0].include[0].where = { id_propietario: id_perfil };
        } else if (rol === 'inquilino') {
            filter.include[0].where = { id_inquilino: id_perfil };
        }

        const pagos = await Pago.findAll(filter);
        res.json(pagos);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener pagos', error: error.message });
    }
};

// Obtener pagos por contrato
const obtenerPorContrato = async (req, res) => {
    try {
        const { id_contrato } = req.params;
        const { id_perfil } = req.usuario;

        const contrato = await Contrato.findOne({
            where: { id_contrato },
            include: [{ model: Inmueble }]
        });

        if (!contrato) return res.status(404).json({ mensaje: 'Contrato no encontrado' });

        const esDuenio = contrato.Inmueble.id_propietario === id_perfil;
        const esInquilino = contrato.id_inquilino === id_perfil;

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
        const { id_perfil } = req.usuario;
        const { id_contrato, monto_total } = req.body;

        const contrato = await Contrato.findOne({
            where: { id_contrato },
            include: [{ model: Inmueble, where: { id_propietario: id_perfil } }]
        });

        if (!contrato) return res.status(403).json({ mensaje: 'No tienes permisos sobre este contrato' });

        const nuevoPago = await Pago.create({ ...req.body, saldo_pendiente: monto_total });
        res.status(201).json({ mensaje: 'Pago registrado exitosamente', pago: nuevoPago });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear pago', error: error.message });
    }
};

// Registrar abono - RF-17
const registrarPago = async (req, res) => {
    const { id } = req.params;
    const { id_perfil } = req.usuario;
    const { monto_pagado, tipo_transaccion, observaciones } = req.body;
    const t = await Pago.sequelize.transaction();
    try {
        const pago = await Pago.findByPk(id, { include: [{ model: Contrato, include: [Inmueble] }], transaction: t });
        if (!pago) { await t.rollback(); return res.status(404).json({ mensaje: 'Pago no encontrado' }); }

        if (parseFloat(monto_pagado) <= 0 || parseFloat(monto_pagado) > parseFloat(pago.saldo_pendiente)) {
            await t.rollback(); return res.status(400).json({ mensaje: 'Monto inválido o superior al saldo' });
        }

        const esDuenio = pago.Contrato.Inmueble.id_propietario === id_perfil;
        const esInquilino = pago.Contrato.id_inquilino === id_perfil;
        if (!esDuenio && !esInquilino) { await t.rollback(); return res.status(403).json({ mensaje: 'No autorizado' }); }
        
        const nuevoSaldo = parseFloat(pago.saldo_pendiente) - parseFloat(monto_pagado);
        const nuevoAbono = await Abono.create({ id_pago: pago.id_pago, monto: monto_pagado, tipo_transaccion, observaciones, saldo_restante_momento: nuevoSaldo }, { transaction: t });

        let nuevoEstado = nuevoSaldo === 0 ? 2 : (pago.estado === 3 ? 3 : 4); 
        await pago.update({ fecha_pago: new Date(), saldo_pendiente: nuevoSaldo, estado: nuevoEstado, tipo_transaccion, observaciones }, { transaction: t });
        
        await t.commit();
        res.json({ mensaje: nuevoSaldo === 0 ? 'Pago completado exitosamente' : 'Abono registrado exitosamente', pago, abono: nuevoAbono });
    } catch (error) { await t.rollback(); res.status(500).json({ mensaje: 'Error', error: error.message }); }
};

// Obtener historial global de abonos
const obtenerHistorialGlobalAbonos = async (req, res) => {
    try {
        const { rol, id_perfil } = req.usuario;
        
        const filter = {
            include: [{
                model: Pago,
                required: true,
                include: [{
                    model: Contrato,
                    required: true,
                    include: [{
                        model: Inmueble,
                        required: true
                    }]
                }]
            }],
            order: [['fecha_abono', 'DESC']]
        };

        if (rol === 'propietario') {
            filter.include[0].include[0].include[0].where = { id_propietario: id_perfil };
        } else if (rol === 'inquilino') {
            filter.include[0].include[0].where = { id_inquilino: id_perfil };
        }

        const abonos = await Abono.findAll(filter);
        res.json(abonos);
    } catch (error) { res.status(500).json({ mensaje: 'Error al obtener historial global', error: error.message }); }
};

// Formateador de moneda
const fmt = (v) => `$ ${parseFloat(v || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;

// Formateador de periodo (Ej: Junio 2026)
const fmtPeriodo = (date) => new Date(date).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).replace(/^\w/, (c) => c.toUpperCase());

// Generar comprobante abono - RF-18 (Versión PDF Estilizada)
const generarComprobanteAbono = async (req, res) => {
    try {
        const { id_abono } = req.params;
        const { id_perfil } = req.usuario;

        const abono = await Abono.findByPk(id_abono, {
            include: [{
                model: Pago,
                include: [{
                    model: Contrato,
                    include: [
                        { model: Inmueble, include: [{ model: Propietario, include: [Usuario] }] },
                        { model: Inquilino, include: [Usuario] }
                    ]
                }]
            }]
        });

        if (!abono) return res.status(404).json({ mensaje: 'No encontrado' });

        const owner = abono.Pago.Contrato.Inmueble.Propietario;
        const tenant = abono.Pago.Contrato.Inquilino;

        if (owner.id_propietario !== id_perfil && tenant.id_inquilino !== id_perfil) {
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        const esTotal = parseFloat(abono.saldo_restante_momento) === 0;
        const periodo = fmtPeriodo(abono.Pago.mes_correspondiente);

        const data = {
            empresa_nombre: "ARRIENDOS 360 S.A.S",
            empresa_nit: "900.123.456-7",
            empresa_telefono: "+57 (601) 321 0000",
            empresa_email: "soporte@arriendos360.com",
            empresa_ciudad: "Bogotá D.C.",
            
            numero_comprobante: `TRX-${abono.id_abono}`,
            fecha_expedicion: new Date(abono.fecha_abono).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }),
            estado_pago: esTotal ? 'PAGADO' : 'ABONO PARCIAL',
            nombre_arrendatario: `${tenant.Usuario.nombres} ${tenant.Usuario.apellidos}`,
            cedula_arrendatario: tenant.id_inquilino,
            telefono_arrendatario: tenant.Usuario.telefono || 'No registrado',
            email_arrendatario: tenant.Usuario.correo,
            direccion_inmueble: abono.Pago.Contrato.Inmueble.direccion,
            barrio_ciudad: `${abono.Pago.Contrato.Inmueble.barrio}, ${abono.Pago.Contrato.Inmueble.municipio}`,
            tipo_inmueble: abono.Pago.Contrato.Inmueble.tipo_inmueble,
            periodo: periodo,
            concepto: esTotal ? `Pago de arriendo periodo ${periodo}` : `Abono arriendo periodo ${periodo}`,
            canon_mensual: fmt(abono.Pago.monto_total),
            valor_pagado: fmt(abono.monto),
            saldo_anterior: fmt(parseFloat(abono.saldo_restante_momento) + parseFloat(abono.monto)),
            saldo_pendiente: fmt(abono.saldo_restante_momento),
            forma_pago: abono.tipo_transaccion || 'Transferencia Bancaria',
            banco: 'Red Bancaria Nacional',
            referencia_pago: abono.observaciones || `Abono No. ${abono.id_abono}`
        };

        const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Comprobante_${id_abono}.pdf"`);
        doc.pipe(res);
        generarPDFComprobante(doc, data);
        doc.end();

    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al generar PDF', error: error.message });
    }
};

// Generar recibo de pago mensual base (Resumen del mes)
const generarRecibo = async (req, res) => {
    try {
        const { id } = req.params;
        const { id_perfil } = req.usuario;
        
        const pago = await Pago.findByPk(id, {
            include: [{
                model: Contrato,
                include: [
                    { model: Inmueble, include: [{ model: Propietario, include: [Usuario] }] },
                    { model: Inquilino, include: [Usuario] }
                ]
            }]
        });
        
        if (!pago) return res.status(404).json({ mensaje: 'No encontrado' });
        
        const owner = pago.Contrato.Inmueble.Propietario;
        const tenant = pago.Contrato.Inquilino;

        if (owner.id_propietario !== id_perfil && tenant.id_inquilino !== id_perfil) {
            return res.status(403).json({ mensaje: 'No autorizado' });
        }

        const esTotal = parseFloat(pago.saldo_pendiente) === 0;
        const periodo = fmtPeriodo(pago.mes_correspondiente);

        const data = {
            empresa_nombre: "ARRIENDOS 360 S.A.S",
            empresa_nit: "900.123.456-7",
            empresa_telefono: "+57 (601) 321 0000",
            empresa_email: "soporte@arriendos360.com",
            empresa_ciudad: "Bogotá D.C.",

            numero_comprobante: `REC-${pago.id_pago}`,
            fecha_expedicion: new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }),
            estado_pago: { 1: 'PENDIENTE', 2: 'PAGADO', 3: 'EN MORA', 4: 'PAGO PARCIAL' }[pago.estado],
            nombre_arrendatario: `${tenant.Usuario.nombres} ${tenant.Usuario.apellidos}`,
            cedula_arrendatario: tenant.id_inquilino,
            telefono_arrendatario: tenant.Usuario.telefono || 'No registrado',
            email_arrendatario: tenant.Usuario.correo,
            direccion_inmueble: pago.Contrato.Inmueble.direccion,
            barrio_ciudad: `${pago.Contrato.Inmueble.barrio}, ${pago.Contrato.Inmueble.municipio}`,
            tipo_inmueble: pago.Contrato.Inmueble.tipo_inmueble,
            periodo: periodo,
            concepto: esTotal ? `Pago de arriendo periodo ${periodo}` : `Abono arriendo periodo ${periodo}`,
            canon_mensual: fmt(pago.monto_total),
            valor_pagado: fmt(parseFloat(pago.monto_total) - parseFloat(pago.saldo_pendiente)),
            saldo_anterior: fmt(pago.monto_total),
            saldo_pendiente: fmt(pago.saldo_pendiente),
            forma_pago: pago.tipo_transaccion || 'Múltiple',
            banco: 'N/A',
            referencia_pago: `Recibo mensual No. ${pago.id_pago}`
        };

        const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Recibo_Mensual_${id}.pdf"`);
        doc.pipe(res);
        generarPDFComprobante(doc, data);
        doc.end();

    } catch (error) { 
        res.status(500).json({ mensaje: 'Error al generar PDF', error: error.message }); 
    }
};

// ... (Restantes métodos)
const obtenerPendientes = async (req, res) => {
    try {
        const { rol, id_perfil } = req.usuario;
        const filter = {
            where: { estado: { [Op.in]: [1, 4] } },
            include: [{ model: Contrato, required: true, include: [{ model: Inmueble, required: true }] }],
            order: [['mes_correspondiente', 'ASC']]
        };
        if (rol === 'propietario') filter.include[0].include[0].where = { id_propietario: id_perfil };
        else if (rol === 'inquilino') filter.include[0].where = { id_inquilino: id_perfil };
        const pagos = await Pago.findAll(filter);
        res.json(pagos);
    } catch (error) { res.status(500).json({ mensaje: 'Error', error: error.message }); }
};

const verificarMora = async (req, res) => {
    try {
        const { id_perfil } = req.usuario;
        const hoy = new Date();
        const pagosVencidos = await Pago.findAll({
            where: { estado: { [Op.in]: [1, 4] }, mes_correspondiente: { [Op.lt]: hoy } },
            include: [{ model: Contrato, required: true, include: [{ model: Inmueble, required: true, where: { id_propietario: id_perfil } }] }]
        });
        for (const pago of pagosVencidos) { await pago.update({ estado: 3 }); }
        res.json({ mensaje: 'Mora verificada', pagos_actualizados: pagosVencidos.length });
    } catch (error) { res.status(500).json({ mensaje: 'Error', error: error.message }); }
};

const obtenerAbonos = async (req, res) => {
    try {
        const { id } = req.params;
        const { id_perfil } = req.usuario;
        const pago = await Pago.findByPk(id, { include: [{ model: Contrato, include: [Inmueble] }] });
        if (!pago) return res.status(404).json({ mensaje: 'No encontrado' });
        if (pago.Contrato.Inmueble.id_propietario !== id_perfil && pago.Contrato.id_inquilino !== id_perfil) return res.status(403).json({ mensaje: 'No autorizado' });
        const abonos = await Abono.findAll({ where: { id_pago: id }, order: [['fecha_abono', 'DESC']] });
        res.json(abonos);
    } catch (error) { res.status(500).json({ mensaje: 'Error al obtener abonos', error: error.message }); }
};

module.exports = { 
    obtenerTodos, obtenerPorContrato, crear, registrarPago, obtenerPendientes,
    verificarMora, generarRecibo, obtenerAbonos, generarComprobanteAbono, obtenerHistorialGlobalAbonos
};