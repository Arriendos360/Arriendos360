const Inmueble = require('../models/Inmueble');
const Propietario = require('../models/Propietario');

// Obtener todos los inmuebles
const obtenerTodos = async (req, res) => {
    try {
        const { rol, id_perfil } = req.usuario;
        let whereClause = {};
        
        // Si es propietario, solo ve sus propios inmuebles
        if (rol === 'propietario') {
            whereClause.id_propietario = id_perfil;
        }
        
        const inmuebles = await Inmueble.findAll({
            where: whereClause,
            include: [{ model: Propietario }]
        });
        res.json(inmuebles);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener inmuebles', error: error.message });
    }
};

// Obtener un inmueble por ID
const obtenerPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const { rol, id_perfil } = req.usuario;
        
        let whereClause = { id_inmueble: id };
        
        // Si es propietario, solo puede ver si le pertenece
        if (rol === 'propietario') {
            whereClause.id_propietario = id_perfil;
        }

        const inmueble = await Inmueble.findOne({
            where: whereClause,
            include: [{ model: Propietario }]
        });
        
        if (!inmueble) {
            return res.status(404).json({ mensaje: 'Inmueble no encontrado o no tienes permisos para verlo' });
        }
        
        res.json(inmueble);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener inmueble', error: error.message });
    }
};

// Crear inmueble
const crear = async (req, res) => {
    try {
        const { id_perfil } = req.usuario;
        
        // Forzar que el propietario sea el usuario autenticado
        const inmuebleData = {
            ...req.body,
            id_propietario: id_perfil
        };

        const nuevoInmueble = await Inmueble.create(inmuebleData);
        res.status(201).json({ 
            mensaje: 'Inmueble creado exitosamente', 
            inmueble: nuevoInmueble 
        });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear inmueble', error: error.message });
    }
};

// Actualizar inmueble
const actualizar = async (req, res) => {
    try {
        const { id } = req.params;
        const { id_perfil } = req.usuario;
        
        const inmueble = await Inmueble.findOne({
            where: { 
                id_inmueble: id,
                id_propietario: id_perfil // Verificar propiedad
            }
        });
        
        if (!inmueble) {
            return res.status(404).json({ mensaje: 'Inmueble no encontrado o no tienes permisos' });
        }
        
        await inmueble.update(req.body);
        res.json({ mensaje: 'Inmueble actualizado', inmueble });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar inmueble', error: error.message });
    }
};

// Eliminar inmueble
const eliminar = async (req, res) => {
    try {
        const { id } = req.params;
        const { id_perfil } = req.usuario;
        
        const inmueble = await Inmueble.findOne({
            where: { 
                id_inmueble: id,
                id_propietario: id_perfil // Verificar propiedad
            }
        });
        
        if (!inmueble) {
            return res.status(404).json({ mensaje: 'Inmueble no encontrado o no tienes permisos' });
        }
        
        await inmueble.destroy();
        res.json({ mensaje: 'Inmueble eliminado' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar inmueble', error: error.message });
    }
};

module.exports = { obtenerTodos, obtenerPorId, crear, actualizar, eliminar };