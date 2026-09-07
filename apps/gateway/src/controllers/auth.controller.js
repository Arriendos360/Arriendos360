const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { sequelize } = require('../config/database');
const { ROLES, ROL_PROPIETARIO } = require('../models/constantes');
const Rol = require('../models/Rol');
const RolUsuario = require('../models/RolUsuario');
const Usuario = require('../models/Usuario');
const {
    emitirToken,
    fechaDeExpiracion,
    revocarToken,
    rolPrincipal
} = require('../services/tokenService');

const CAMPOS_OBLIGATORIOS = ['nombres', 'apellidos', 'email', 'contrasena', 'documento'];

/** Devuelve el nombre del primer campo obligatorio que falte, o null. */
const campoFaltante = (cuerpo) =>
    CAMPOS_OBLIGATORIOS.find((campo) => !cuerpo || !cuerpo[campo]) || null;

/** Nombres de rol de un usuario, en mayúsculas, tal como van en los claims. */
const rolesDe = async (idUsuario) => {
    const filas = await RolUsuario.findAll({
        where: { id_usuario: idUsuario },
        include: [{ model: Rol, attributes: ['nombre'] }]
    });

    return filas.map((fila) => fila.Rol.nombre);
};

/**
 * Alta de usuario con un rol concreto.
 *
 * `idAutor` es quien queda registrado en las columnas de auditoría. En el
 * autorregistro no hay usuario autenticado, así que se pasa el UUID del propio
 * usuario que se está creando: lo conocemos porque lo generamos antes del
 * INSERT, que es justamente para lo que sirve generar los identificadores en la
 * aplicación y no con un DEFAULT de la base.
 */
const crearUsuarioConRol = async ({ cuerpo, rol, idAutor = null }) => {
    const { nombres, apellidos, email, contrasena, telefono, documento } = cuerpo;

    const emailExiste = await Usuario.findOne({ where: { email } });
    if (emailExiste) {
        return { error: { estado: 400, mensaje: 'El email ya está registrado' } };
    }

    const documentoExiste = await Usuario.findOne({ where: { documento } });
    if (documentoExiste) {
        return { error: { estado: 400, mensaje: 'El documento ya está registrado' } };
    }

    const idUsuario = crypto.randomUUID();
    const autor = idAutor || idUsuario;
    const hash = await bcrypt.hash(contrasena, 10);

    const usuario = await sequelize.transaction(async (transaccion) => {
        const nuevo = await Usuario.create(
            {
                id_usuario: idUsuario,
                nombres,
                apellidos,
                email,
                contrasena: hash,
                telefono,
                documento,
                creado_por: autor
            },
            { transaction: transaccion, usuarioAuditor: autor }
        );

        await RolUsuario.create(
            { id_rol: ROLES[rol], id_usuario: idUsuario, creado_por: autor },
            { transaction: transaccion, usuarioAuditor: autor }
        );

        return nuevo;
    });

    return { usuario };
};

/**
 * POST /api/auth/registro — ruta pública.
 *
 * El contrato de interfaz del Capítulo 2 no lleva campo `rol`: «la asignación
 * del rol en RolesUsuario se maneja internamente». El registro público siempre
 * crea un PROPIETARIO, que es lo que la SPA ya ofrecía («solo propietarios se
 * registran»). Los inquilinos se dan de alta desde POST /api/usuarios/inquilinos,
 * que exige un propietario autenticado.
 */
const registrar = async (req, res) => {
    try {
        const faltante = campoFaltante(req.body);
        if (faltante) {
            return res.status(400).json({ mensaje: `El campo ${faltante} es obligatorio` });
        }

        const { error, usuario } = await crearUsuarioConRol({
            cuerpo: req.body,
            rol: ROL_PROPIETARIO
        });

        if (error) {
            return res.status(error.estado).json({ mensaje: error.mensaje });
        }

        return res.status(201).json({
            mensaje: 'Usuario registrado exitosamente',
            usuario: {
                id: usuario.id_usuario,
                email: usuario.email,
                rol: ROL_PROPIETARIO,
                nombres: usuario.nombres
            }
        });
    } catch (error) {
        console.error('Error al registrar usuario:', error);
        return res.status(500).json({ mensaje: 'Error al registrar usuario', error: error.message });
    }
};

/**
 * POST /api/auth/login — ruta pública.
 *
 * Respuesta según el Capítulo 2: `token`, `tipo_token`, `expiracion` y `usuario`
 * con `id` y `rol` singular.
 */
const login = async (req, res) => {
    try {
        const { email, contrasena } = req.body || {};

        if (!email || !contrasena) {
            return res.status(400).json({ mensaje: 'El email y la contraseña son obligatorios' });
        }

        if (!process.env.JWT_SECRET) {
            console.error('ERROR: JWT_SECRET no está definido en el entorno');
            return res.status(500).json({ mensaje: 'Error de configuración en el servidor' });
        }

        const usuario = await Usuario.findOne({ where: { email } });
        if (!usuario) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado' });
        }

        const contrasenaValida = await bcrypt.compare(contrasena, usuario.contrasena);
        if (!contrasenaValida) {
            return res.status(401).json({ mensaje: 'Contraseña incorrecta' });
        }

        const roles = await rolesDe(usuario.id_usuario);
        const { token, tipo_token, expiracion } = emitirToken(usuario, roles);

        return res.json({
            mensaje: 'Login exitoso',
            token,
            tipo_token,
            expiracion,
            usuario: {
                id: usuario.id_usuario,
                rol: rolPrincipal(roles),
                // Fuera del contrato mínimo, pero la SPA los pinta en la barra
                // superior y pedirlos aparte sería una llamada de más.
                nombres: usuario.nombres,
                apellidos: usuario.apellidos,
                email: usuario.email,
                roles
            }
        });
    } catch (error) {
        console.error('Error en controlador login:', error);
        return res.status(500).json({ mensaje: 'Error al iniciar sesión', error: error.message });
    }
};

/**
 * POST /api/auth/logout — ruta protegida, cuerpo vacío.
 *
 * Registra el `jti` del token en la lista de revocados hasta su expiración
 * natural. A partir de ahí el middleware lo rechaza con 401 aunque la firma siga
 * siendo válida, que es todo el punto de tener `jti` en los claims.
 */
const logout = async (req, res) => {
    try {
        await revocarToken(req.usuario.jti, fechaDeExpiracion(req.usuario));
        return res.json({ mensaje: 'Sesión cerrada' });
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        return res.status(500).json({ mensaje: 'Error al cerrar sesión', error: error.message });
    }
};

module.exports = { CAMPOS_OBLIGATORIOS, campoFaltante, crearUsuarioConRol, login, logout, registrar, rolesDe };
