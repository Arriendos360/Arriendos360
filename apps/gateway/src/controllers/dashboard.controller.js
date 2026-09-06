const { Sequelize } = require('sequelize');
const Pago = require('../models/Pago');
const Contrato = require('../models/Contrato');
const Inmueble = require('../models/Inmueble');

// Obtener ingresos totales (suma de pagos realizados)
const obtenerIngresos = async (req, res) => {
    try {
        const { id_perfil } = req.usuario;
        
        const resultado = await Pago.findAll({
            where: { estado: 2 }, // 2 = Pagado
            attributes: [
                [Sequelize.fn('SUM', Sequelize.col('monto_total')), 'total_ingresos'],
                [Sequelize.fn('COUNT', Sequelize.col('id_pago')), 'cantidad_pagos']
            ],
            include: [{
                model: Contrato,
                attributes: [],
                required: true,
                include: [{
                    model: Inmueble,
                    attributes: [],
                    required: true,
                    where: { id_propietario: id_perfil }
                }]
            }],
            raw: true
        });
        
        res.json({
            total_ingresos: resultado[0].total_ingresos || 0,
            cantidad_pagos: resultado[0].cantidad_pagos || 0
        });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener ingresos', error: error.message });
    }
};

// Obtener pagos en mora (vencidos o pendientes con fecha pasada)
const obtenerMora = async (req, res) => {
    try {
        const { id_perfil } = req.usuario;
        const hoy = new Date();
        
        const pagosEnMora = await Pago.findAll({
            where: {
                [Sequelize.Op.or]: [
                    { 
                        estado: 1, // Pendiente
                        mes_correspondiente: { [Sequelize.Op.lt]: hoy }
                    },
                    { estado: 3 } // Vencido
                ]
            },
            include: [{ 
                model: Contrato,
                include: [{
                    model: Inmueble,
                    where: { id_propietario: id_perfil }
                }]
            }]
        });
        
        const totalMora = pagosEnMora.reduce((sum, pago) => {
            const pendiente = parseFloat(pago.saldo_pendiente);
            const total = parseFloat(pago.monto_total);
            return sum + (pendiente > 0 ? pendiente : total);
        }, 0);
        
        res.json({
            cantidad_en_mora: pagosEnMora.length,
            total_mora: totalMora,
            detalle: pagosEnMora
        });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener mora', error: error.message });
    }
};

// Obtener contratos activos
const obtenerContratosActivos = async (req, res) => {
    try {
        const { id_perfil } = req.usuario;
        
        const contratosActivos = await Contrato.findAll({
            where: { estado: 1 }, // 1 = Activo
            include: [{ 
                model: Inmueble,
                where: { id_propietario: id_perfil }
            }]
        });
        
        res.json({
            cantidad_activos: contratosActivos.length,
            contratos: contratosActivos
        });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener contratos activos', error: error.message });
    }
};

// Resumen general del Dashboard
const obtenerResumen = async (req, res) => {
    try {
        const { id_perfil } = req.usuario;

        // Total ingresos
        const ingresos = await Pago.findAll({
            where: { estado: 2 },
            attributes: [[Sequelize.fn('SUM', Sequelize.col('monto_total')), 'total']],
            include: [{
                model: Contrato,
                attributes: [],
                required: true,
                include: [{
                    model: Inmueble,
                    attributes: [],
                    required: true,
                    where: { id_propietario: id_perfil }
                }]
            }],
            raw: true
        });
        
        // Contratos activos
        const contratosActivos = await Contrato.count({ 
            where: { estado: 1 },
            include: [{ model: Inmueble, where: { id_propietario: id_perfil } }]
        });
        
        // Contratos finalizados
        const contratosFinalizados = await Contrato.count({ 
            where: { estado: 2 },
            include: [{ model: Inmueble, where: { id_propietario: id_perfil } }]
        });
        
        // Inmuebles disponibles
        const inmueblesDisponibles = await Inmueble.count({ 
            where: { estado_ocupacion: 'disponible', id_propietario: id_perfil } 
        });
        
        // Inmuebles arrendados
        const inmueblesArrendados = await Inmueble.count({ 
            where: { estado_ocupacion: 'arrendado', id_propietario: id_perfil } 
        });
        
        // Pagos pendientes
        const pagosPendientes = await Pago.count({
            where: { estado: 1 },
            include: [{
                model: Contrato,
                required: true,
                include: [{
                    model: Inmueble,
                    required: true,
                    where: { id_propietario: id_perfil }
                }]
            }]
        });
        
        res.json({
            ingresos_totales: ingresos[0].total || 0,
            contratos: {
                activos: contratosActivos,
                finalizados: contratosFinalizados
            },
            inmuebles: {
                disponibles: inmueblesDisponibles,
                arrendados: inmueblesArrendados
            },
            pagos_pendientes: pagosPendientes
        });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener resumen', error: error.message });
    }
};

module.exports = { obtenerIngresos, obtenerMora, obtenerContratosActivos, obtenerResumen };