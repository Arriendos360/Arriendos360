const { sequelize } = require('../config/database');
const Contrato = require('../models/Contrato');
const Inmueble = require('../models/Inmueble');
const Inquilino = require('../models/Inquilino');

// Obtener todos los contratos
const obtenerTodos = async (req, res) => {
    try {
        const { rol, id_perfil } = req.usuario;
        let whereContrato = {};
        let whereInmueble = {};

        if (rol === 'propietario') {
            whereInmueble.id_propietario = id_perfil;
        } else if (rol === 'inquilino') {
            whereContrato.id_inquilino = id_perfil;
        }

        const contratos = await Contrato.findAll({
            where: whereContrato,
            include: [
                { 
                    model: Inmueble,
                    where: Object.keys(whereInmueble).length > 0 ? whereInmueble : undefined
                },
                { model: Inquilino }
            ]
        });
        res.json(contratos);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener contratos', error: error.message });
    }
};

// Obtener contrato por ID
const obtenerPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const { rol, id_perfil } = req.usuario;

        const contrato = await Contrato.findByPk(id, {
            include: [
                { model: Inmueble },
                { model: Inquilino }
            ]
        });
        
        if (!contrato) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado' });
        }

        // Validar permisos
        const esDuenioInmueble = contrato.Inmueble.id_propietario === id_perfil;
        const esInquilinoContrato = contrato.id_inquilino === id_perfil;

        if (rol === 'propietario' && !esDuenioInmueble) {
            return res.status(403).json({ mensaje: 'No tienes permisos para ver este contrato' });
        }

        if (rol === 'inquilino' && !esInquilinoContrato) {
            return res.status(403).json({ mensaje: 'No tienes permisos para ver este contrato' });
        }
        
        res.json(contrato);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener contrato', error: error.message });
    }
};

const crear = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id_perfil } = req.usuario;
        const { id_inmueble, id_inquilino, fecha_inicio, fecha_fin, valor_mensual } = req.body;
        const contratoData = { ...req.body };
        
        // 0. Verificar que el inmueble pertenece al propietario autenticado
        const inmueble = await Inmueble.findOne({
            where: {
                id_inmueble: id_inmueble,
                id_propietario: id_perfil
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

        // 2. Verificar que el inquilino existe
        const InquilinoModel = require('../models/Inquilino');
        let inquilino = await InquilinoModel.findByPk(id_inquilino);
        
        if (!inquilino) {
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

        const nuevoContrato = await Contrato.create(contratoData, { transaction: t });
        
        // 4. Actualizar estado del inmueble
        await Inmueble.update(
            { estado_ocupacion: 'arrendado' },
            { 
                where: { id_inmueble: id_inmueble },
                transaction: t 
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
        const { id_perfil } = req.usuario;
        
        const contrato = await Contrato.findByPk(id, {
            include: [{ model: Inmueble }]
        });
        
        if (!contrato || contrato.Inmueble.id_propietario !== id_perfil) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado o no tienes permisos' });
        }
        
        await contrato.update(req.body);
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
        const { id_perfil } = req.usuario;
        
        const contrato = await Contrato.findByPk(id, {
            include: [{ model: Inmueble }]
        });
        
        if (!contrato || contrato.Inmueble.id_propietario !== id_perfil) {
            await t.rollback();
            return res.status(404).json({ mensaje: 'Contrato no encontrado o no tienes permisos' });
        }
        
        // Cambiar estado a finalizado (2)
        await contrato.update({ estado: 2 }, { transaction: t });
        
        // Liberar inmueble
        await Inmueble.update(
            { estado_ocupacion: 'disponible' },
            { 
                where: { id_inmueble: contrato.id_inmueble },
                transaction: t 
            }
        );
        
        await t.commit();
        res.json({ mensaje: 'Contrato finalizado', contrato });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ mensaje: 'Error al finalizar contrato', error: error.message });
    }
};

module.exports = { obtenerTodos, obtenerPorId, crear, actualizar, finalizar };