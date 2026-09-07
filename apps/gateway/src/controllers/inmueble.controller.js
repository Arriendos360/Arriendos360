const Inmueble = require('../models/Inmueble');

/**
 * El propietario de un inmueble es un UUID de usuario que sale siempre del `sub`
 * del token, nunca del cuerpo de la petición (regla dura 4).
 *
 * Estas respuestas ya NO traen los datos del propietario. Antes venían por un
 * `include` que cruzaba a ms-identidad, y al extraerlo hubo que decidir entre
 * componerlos por HTTP o quitarlos. Se quitaron: nadie los usaba. El frontend
 * nunca lee `inmueble.Propietario`, y no podía ser de otro modo — quien mira
 * este listado es el propietario, así que serían sus propios datos repetidos en
 * cada fila.
 *
 * CAMBIO DE COMPORTAMIENTO DELIBERADO. El código anterior filtraba por
 * propietario sólo si `rol === 'propietario'`; cualquier otro usuario
 * autenticado caía en el `else` sin filtro y recibía TODOS los inmuebles de la
 * plataforma, con dirección incluida. Como este PR es el del módulo de
 * seguridad, el filtro pasa a aplicarse siempre: un inmueble sólo lo ve su
 * dueño. Es la validación ABAC de pertenencia de la regla dura 8.
 */
// Obtener todos los inmuebles del propietario autenticado
const obtenerTodos = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const inmuebles = await Inmueble.findAll({ where: { id_propietario: sub } });
        res.json(inmuebles);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener inmuebles', error: error.message });
    }
};

// Obtener un inmueble por ID
const obtenerPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const inmueble = await Inmueble.findOne({
            where: { id_inmueble: id, id_propietario: sub }
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
        const { sub } = req.usuario;

        // Forzar que el propietario sea el usuario autenticado, pase lo que pase
        // en el cuerpo de la petición.
        const inmuebleData = {
            ...req.body,
            id_propietario: sub
        };

        const nuevoInmueble = await Inmueble.create(inmuebleData, { usuarioAuditor: sub });
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
        const { sub } = req.usuario;

        const inmueble = await Inmueble.findOne({
            where: {
                id_inmueble: id,
                id_propietario: sub // Verificar propiedad
            }
        });

        if (!inmueble) {
            return res.status(404).json({ mensaje: 'Inmueble no encontrado o no tienes permisos' });
        }

        // `id_propietario` no se puede reasignar desde el cuerpo: cederle un
        // inmueble a otro usuario no es una actualización, y hoy no existe.
        const { id_propietario, ...cambios } = req.body;

        await inmueble.update(cambios, { usuarioAuditor: sub });
        res.json({ mensaje: 'Inmueble actualizado', inmueble });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar inmueble', error: error.message });
    }
};

// Eliminar inmueble
const eliminar = async (req, res) => {
    try {
        const { id } = req.params;
        const { sub } = req.usuario;

        const inmueble = await Inmueble.findOne({
            where: {
                id_inmueble: id,
                id_propietario: sub // Verificar propiedad
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
