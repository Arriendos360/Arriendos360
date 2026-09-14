/**
 * Doble de ms-identidad para las pruebas del gateway.
 *
 * Es un servidor HTTP de verdad, con usuarios en memoria, que habla el mismo
 * protocolo que el servicio real. No es un mock de una función: la costura del
 * gateway reenvía por red, así que para probar el gateway hace falta algo que
 * escuche.
 *
 * Por qué un doble y no el servicio real:
 *
 * - **Velocidad.** Levantar ms-identidad exigiría su conexión a PostgreSQL, sus
 *   migraciones y su esquema. Las suites del gateway pasarían de segundos a
 *   minutos, y dejarían de correr en un portátil sin Docker.
 * - **Aislamiento.** Un fallo aquí debe significar «el gateway está mal», no «la
 *   identidad está mal». Si las dos cosas se prueban juntas, un cambio en
 *   ms-identidad pone en rojo suites que no tienen nada que ver.
 * - **Control.** Con el doble se puede simular lo que con el servicio real es
 *   incómodo: que no responda, que tarde, que devuelva un usuario sin rol.
 *
 * Lo que el doble NO prueba es que el contrato entre los dos sea cierto. De eso
 * se encarga la suite de integración contra el stack real
 * (`tests/integracion/`), que recorre los caminos críticos de punta a punta.
 */

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { exigirServicio } = require('arriendos360-shared');

const VIGENCIA_SEGUNDOS = 3600;

/**
 * Crea el doble y lo pone a escuchar en un puerto efímero.
 *
 * @returns {Promise<object>} controlador con `url`, `cerrar()` y utilidades para
 *   inspeccionar y manipular el estado desde una prueba.
 */
const crearIdentidadFalsa = async (opciones = {}) => {
    const secreto = opciones.secreto || process.env.JWT_SECRET;

    /** @type {Map<string, object>} usuarios por id */
    const usuarios = new Map();
    /** @type {Set<string>} jti revocados */
    const revocados = new Set();
    /** @type {Map<string, number>} sub -> ms desde los que sus tokens no valen */
    const sesionesInvalidadas = new Map();
    /** Peticiones recibidas, para que una prueba pueda afirmar sobre ellas. */
    const llamadas = [];

    const app = express();
    app.use(express.json());
    app.use((req, _res, siguiente) => {
        llamadas.push({ metodo: req.method, ruta: req.originalUrl });
        siguiente();
    });

    /** Verifica el token como lo haría el servicio real. */
    const claimsDe = (req) => {
        const cabecera = req.headers['authorization'];
        if (!cabecera) return null;
        const [esquema, valor] = cabecera.split(' ');
        if (!valor || esquema.toLowerCase() !== 'bearer') return null;
        try {
            return jwt.verify(valor, secreto);
        } catch {
            return null;
        }
    };

    const crear = ({ nombres, apellidos, email, telefono, documento, roles }) => {
        const id = crypto.randomUUID();
        const usuario = { id, nombres, apellidos, email, telefono: telefono || null, documento, roles };
        usuarios.set(id, usuario);
        return usuario;
    };

    const porEmail = (email) => [...usuarios.values()].find((u) => u.email === email);
    const porDocumento = (documento) => [...usuarios.values()].find((u) => u.documento === documento);

    // ── /api/auth ───────────────────────────────────────────────────────────
    app.post('/api/auth/registro', (req, res) => {
        const { nombres, apellidos, email, contrasena, telefono, documento } = req.body || {};

        for (const campo of ['nombres', 'apellidos', 'email', 'contrasena', 'documento']) {
            if (!req.body || !req.body[campo]) {
                return res.status(400).json({ mensaje: `El campo ${campo} es obligatorio` });
            }
        }
        if (porEmail(email)) return res.status(400).json({ mensaje: 'El email ya está registrado' });
        if (porDocumento(documento)) {
            return res.status(400).json({ mensaje: 'El documento ya está registrado' });
        }

        // El registro público siempre crea PROPIETARIO, igual que el real.
        const usuario = crear({ nombres, apellidos, email, telefono, documento, roles: ['PROPIETARIO'] });
        usuario.contrasena = contrasena;

        return res.status(201).json({
            mensaje: 'Usuario registrado exitosamente',
            usuario: { id: usuario.id, email, rol: 'PROPIETARIO', nombres }
        });
    });

    app.post('/api/auth/login', (req, res) => {
        const { email, contrasena } = req.body || {};
        if (!email || !contrasena) {
            return res.status(400).json({ mensaje: 'El email y la contraseña son obligatorios' });
        }

        const usuario = porEmail(email);
        // Un solo 401 para «no existe» y «contraseña mal», como el servicio real
        // desde docs/adr/0020: el login no dice qué correos están registrados.
        if (!usuario || usuario.contrasena !== contrasena) {
            return res.status(401).json({ mensaje: 'Correo o contraseña incorrectos' });
        }

        const jti = crypto.randomUUID();
        const token = jwt.sign(
            { sub: usuario.id, email: usuario.email, roles: usuario.roles, jti },
            secreto,
            { expiresIn: VIGENCIA_SEGUNDOS }
        );

        return res.json({
            mensaje: 'Login exitoso',
            token,
            tipo_token: 'Bearer',
            expiracion: new Date(Date.now() + VIGENCIA_SEGUNDOS * 1000).toISOString(),
            usuario: {
                id: usuario.id,
                rol: usuario.roles.includes('PROPIETARIO') ? 'PROPIETARIO' : usuario.roles[0] || null,
                nombres: usuario.nombres,
                apellidos: usuario.apellidos,
                email: usuario.email,
                roles: usuario.roles
            }
        });
    });

    app.post('/api/auth/logout', (req, res) => {
        const claims = claimsDe(req);
        if (!claims) return res.status(401).json({ mensaje: 'Acceso denegado. No se proporcionó un token.' });
        revocados.add(claims.jti);
        return res.json({ mensaje: 'Sesión cerrada' });
    });

    // ── /api/usuarios ───────────────────────────────────────────────────────
    app.get('/api/usuarios', (req, res) => {
        const claims = claimsDe(req);
        if (!claims) return res.status(401).json({ mensaje: 'Acceso denegado. No se proporcionó un token.' });
        if (!claims.roles.includes('PROPIETARIO')) {
            return res.status(403).json({ mensaje: 'Acceso restringido. Se requiere rol de propietario.' });
        }

        const { documento } = req.query;
        if (!documento) return res.status(400).json({ mensaje: 'El documento es obligatorio' });

        const usuario = porDocumento(documento);
        if (!usuario) return res.status(404).json({ mensaje: 'Usuario no encontrado' });

        return res.json({ id: usuario.id, nombres: usuario.nombres, apellidos: usuario.apellidos });
    });

    app.post('/api/usuarios/inquilinos', (req, res) => {
        const claims = claimsDe(req);
        if (!claims) return res.status(401).json({ mensaje: 'Acceso denegado. No se proporcionó un token.' });
        if (!claims.roles.includes('PROPIETARIO')) {
            return res.status(403).json({ mensaje: 'Acceso restringido. Se requiere rol de propietario.' });
        }

        const { nombres, apellidos, email, contrasena, telefono, documento } = req.body || {};
        if (porEmail(email)) return res.status(400).json({ mensaje: 'El email ya está registrado' });
        if (porDocumento(documento)) {
            return res.status(400).json({ mensaje: 'El documento ya está registrado' });
        }

        const usuario = crear({ nombres, apellidos, email, telefono, documento, roles: ['INQUILINO'] });
        usuario.contrasena = contrasena;

        return res.status(201).json({
            mensaje: 'Inquilino registrado exitosamente',
            usuario: { id: usuario.id, email, rol: 'INQUILINO', nombres, apellidos, documento }
        });
    });

    // ── /interno ────────────────────────────────────────────────────────────
    // El doble EXIGE la credencial de servicio, igual que el real. Si no lo
    // hiciera, las pruebas del gateway pasarían aunque olvidara mandarla, que es
    // exactamente el fallo que nadie quiere descubrir en producción.
    app.use(
        '/interno',
        exigirServicio({
            destinatario: 'ms-identidad',
            secreto: opciones.secretoServicio || process.env.SERVICIO_JWT_SECRET
        })
    );

    app.get('/interno/usuarios', (req, res) => {
        const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
        return res.json({
            usuarios: ids.map((id) => usuarios.get(id.trim())).filter(Boolean)
        });
    });

    app.get('/interno/revocados', (_req, res) => {
        return res.json({
            revocados: [...revocados].map((jti) => ({
                jti,
                expira_en: new Date(Date.now() + VIGENCIA_SEGUNDOS * 1000).toISOString()
            })),
            // Invalidación en bloque: usuarios cuyas sesiones anteriores a
            // esa marca dejaron de valer.
            sesiones: [...sesionesInvalidadas.entries()].map(([sub, desde]) => ({
                sub,
                desde: new Date(desde).toISOString()
            })),
            generado_en: new Date().toISOString()
        });
    });

    app.post('/interno/usuarios/:id/contrasena-temporal', (req, res) => {
        // `solicitado_por` llega en el cuerpo: es la persona que pidió la
        // reemisión, para la auditoría del otro lado.
        const usuario = usuarios.get(req.params.id);
        if (!usuario) return res.status(404).json({ mensaje: 'Usuario no encontrado' });

        const temporal = crypto.randomBytes(6).toString('hex');
        usuario.contrasena = temporal;
        sesionesInvalidadas.set(usuario.id, Date.now());

        return res.json({
            mensaje: 'Contraseña temporal regenerada',
            contrasena_temporal: temporal,
            usuario: {
                id: usuario.id,
                nombres: usuario.nombres,
                apellidos: usuario.apellidos,
                debe_cambiar_contrasena: true
            }
        });
    });

    const servidor = await new Promise((resolver) => {
        const s = app.listen(0, '127.0.0.1', () => resolver(s));
    });

    return {
        url: `http://127.0.0.1:${servidor.address().port}`,
        /** Añade un rol a un usuario ya creado, sin pasar por la API. */
        agregarRol: (id, rol) => usuarios.get(id)?.roles.push(rol),
        usuarios,
        revocados,
        sesionesInvalidadas,
        llamadas,
        /** Olvida las llamadas registradas, para afirmar sobre un tramo concreto. */
        limpiarLlamadas: () => llamadas.splice(0, llamadas.length),
        cerrar: () => new Promise((resolver) => servidor.close(resolver))
    };
};

module.exports = { crearIdentidadFalsa };
