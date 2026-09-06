const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sequelize } = require('../config/database');
const Usuario = require('../models/Usuario');
const Propietario = require('../models/Propietario');
const Inquilino = require('../models/Inquilino');

// Registrar usuario
const registrar = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { correo, contrasena, rol, nombres, apellidos, telefono, documento } = req.body;

        if (!documento) {
            return res.status(400).json({ mensaje: 'El número de documento es obligatorio' });
        }

        // Verificar si el usuario ya existe
        const usuarioExiste = await Usuario.findOne({ where: { correo } });
        if (usuarioExiste) {
            await t.rollback();
            return res.status(400).json({ mensaje: 'El correo ya está registrado' });
        }

        // Cifrar contraseña
        const hash_contrasena = await bcrypt.hash(contrasena, 10);

        // Crear usuario
        const nuevoUsuario = await Usuario.create({
            correo,
            hash_contrasena,
            rol,
            nombres,
            apellidos,
            telefono
        }, { transaction: t });

        // Crear perfil según el rol
        if (rol === 'propietario') {
            await Propietario.create({
                id_propietario: documento,
                id_usuario: nuevoUsuario.id_usuario
            }, { transaction: t });
        } else if (rol === 'inquilino') {
            await Inquilino.create({
                id_inquilino: documento,
                id_usuario: nuevoUsuario.id_usuario
            }, { transaction: t });
        }

        await t.commit();

        res.status(201).json({ 
            mensaje: 'Usuario registrado exitosamente',
            usuario: {
                id: nuevoUsuario.id_usuario,
                correo: nuevoUsuario.correo,
                rol: nuevoUsuario.rol,
                nombres: nuevoUsuario.nombres
            }
        });

    } catch (error) {
        await t.rollback();
        console.error(error);
        res.status(500).json({ mensaje: 'Error al registrar usuario', error: error.message });
    }
};

// Iniciar sesión
const login = async (req, res) => {
    try {
        const { correo, contrasena } = req.body;
        console.log('Intentando login para:', correo);

        // Buscar usuario
        const usuario = await Usuario.findOne({ where: { correo } });
        
        if (!usuario) {
            console.log('Usuario no encontrado en DB:', correo);
            return res.status(404).json({ mensaje: 'Usuario no encontrado' });
        }

        console.log('Usuario encontrado, verificando contraseña...');
        // Verificar contraseña
        const contrasenaValida = await bcrypt.compare(contrasena, usuario.hash_contrasena);
        if (!contrasenaValida) {
            console.log('Contraseña incorrecta para:', correo);
            return res.status(401).json({ mensaje: 'Contraseña incorrecta' });
        }

        // Generar token JWT
        if (!process.env.JWT_SECRET) {
            console.error('ERROR: JWT_SECRET no está definido en el entorno');
            return res.status(500).json({ mensaje: 'Error de configuración en el servidor' });
        }

        // Buscar perfil asociado
        let id_perfil = null;
        if (usuario.rol === 'propietario') {
            const prop = await Propietario.findOne({ where: { id_usuario: usuario.id_usuario } });
            id_perfil = prop ? prop.id_propietario : null;
        } else if (usuario.rol === 'inquilino') {
            const inq = await Inquilino.findOne({ where: { id_usuario: usuario.id_usuario } });
            id_perfil = inq ? inq.id_inquilino : null;
        }

        const token = jwt.sign(
            { 
                id: usuario.id_usuario, 
                correo: usuario.correo, 
                rol: usuario.rol,
                id_perfil: id_perfil
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('Login exitoso para:', correo);
        res.json({
            mensaje: 'Login exitoso',
            token,
            usuario: {
                id: usuario.id_usuario,
                correo: usuario.correo,
                rol: usuario.rol,
                nombres: usuario.nombres,
                apellidos: usuario.apellidos
            }
        });

    } catch (error) {
        console.error('Error en controlador login:', error);
        res.status(500).json({ mensaje: 'Error al iniciar sesión', error: error.message });
    }
};

module.exports = { registrar, login };