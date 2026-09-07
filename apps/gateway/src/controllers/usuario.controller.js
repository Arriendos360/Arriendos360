const { ROL_INQUILINO } = require('../models/constantes');
const Usuario = require('../models/Usuario');
const { campoFaltante, crearUsuarioConRol } = require('./auth.controller');

/**
 * GET /api/usuarios/buscar?documento=...
 *
 * Existe por el paso a UUID. Antes el propietario escribía la cédula del
 * inquilino en el formulario de contrato y esa cédula ERA el `id_inquilino`.
 * Ahora la identidad es un UUID que nadie teclea, así que la SPA traduce
 * documento -> UUID por aquí antes de enviar el contrato.
 *
 * Devuelve lo mínimo para que el propietario confirme que encontró a la persona
 * correcta. Nada de email ni teléfono: quien busca no es necesariamente alguien
 * con derecho a esos datos, y basta el nombre para desambiguar.
 */
const buscarPorDocumento = async (req, res) => {
    try {
        const { documento } = req.query;

        if (!documento) {
            return res.status(400).json({ mensaje: 'El documento es obligatorio' });
        }

        const usuario = await Usuario.findOne({
            where: { documento },
            attributes: ['id_usuario', 'nombres', 'apellidos', 'documento']
        });

        if (!usuario) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado' });
        }

        return res.json({
            id: usuario.id_usuario,
            nombres: usuario.nombres,
            apellidos: usuario.apellidos,
            documento: usuario.documento
        });
    } catch (error) {
        return res.status(500).json({ mensaje: 'Error al buscar usuario', error: error.message });
    }
};

/**
 * POST /api/usuarios/inquilinos — exige propietario autenticado.
 *
 * Contrapartida del registro público, que siempre crea PROPIETARIO. El
 * propietario da de alta al inquilino desde el formulario de contrato cuando la
 * búsqueda por documento no encuentra a nadie.
 *
 * Queda registrado en la auditoría quién lo creó: `creado_por` lleva el `sub`
 * del propietario, no el UUID del propio inquilino.
 */
const crearInquilino = async (req, res) => {
    try {
        const faltante = campoFaltante(req.body);
        if (faltante) {
            return res.status(400).json({ mensaje: `El campo ${faltante} es obligatorio` });
        }

        const { error, usuario } = await crearUsuarioConRol({
            cuerpo: req.body,
            rol: ROL_INQUILINO,
            idAutor: req.usuario.sub
        });

        if (error) {
            return res.status(error.estado).json({ mensaje: error.mensaje });
        }

        return res.status(201).json({
            mensaje: 'Inquilino registrado exitosamente',
            usuario: {
                id: usuario.id_usuario,
                email: usuario.email,
                rol: ROL_INQUILINO,
                nombres: usuario.nombres,
                apellidos: usuario.apellidos,
                documento: usuario.documento
            }
        });
    } catch (error) {
        console.error('Error al registrar inquilino:', error);
        return res.status(500).json({ mensaje: 'Error al registrar inquilino', error: error.message });
    }
};

module.exports = { buscarPorDocumento, crearInquilino };
