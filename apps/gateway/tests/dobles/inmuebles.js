/**
 * Doble de ms-inmuebles para las pruebas del gateway.
 *
 * Mismo razonamiento que el de identidad: la costura reenvía por red, así que
 * para probar el gateway hace falta algo que escuche. Un mock de función no
 * ejercitaría ni el reenvío, ni la credencial de servicio, ni la política de
 * fallo del cliente.
 *
 * Este doble tiene una responsabilidad extra que el de identidad no tenía: sirve
 * `/api/inmuebles` ADEMÁS de `/interno`. Es lo que la costura reenvía cuando la
 * suite crea un inmueble, y por eso aplica el mismo ABAC que el servicio real —
 * un inmueble ajeno responde 404. Sin eso, las pruebas de seguridad del gateway
 * pasarían contra un servicio que regala datos.
 *
 * Lo que el doble NO prueba es que el contrato entre los dos sea cierto. De eso
 * se encarga la suite de integración contra el stack real.
 */

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { exigirServicio } = require('arriendos360-shared');

const TIPOS = ['apartamento', 'casa', 'local', 'oficina', 'bodega', 'apartaestudio'];
const ESTADOS = ['disponible', 'arrendado'];

const crearInmueblesFalso = async (opciones = {}) => {
    const secreto = opciones.secreto || process.env.JWT_SECRET;

    /** @type {Map<string, object>} inmuebles por id */
    const inmuebles = new Map();
    /** Peticiones recibidas, para que una prueba pueda afirmar sobre ellas. */
    const llamadas = [];
    /** Si se pone, las peticiones que casen fallan con este código. */
    let fallarCon = null;
    /** Qué rutas caen. `null` = todas. Permite tirar solo una parte del servicio. */
    let fallarSolo = null;

    const app = express();
    app.use(express.json());
    app.use((req, res, siguiente) => {
        llamadas.push({ metodo: req.method, ruta: req.originalUrl });
        if (fallarCon !== null && (fallarSolo === null || fallarSolo.test(req.originalUrl))) {
            return res.status(fallarCon).json({ mensaje: 'Doble caído a propósito' });
        }
        return siguiente();
    });

    /** Verifica el token como lo haría el servicio real (confianza cero). */
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

    // ── /api/inmuebles ──────────────────────────────────────────────────────
    // Lo que llega por la costura. Repite las dos capas del servicio real: token
    // válido y rol de propietario, y después pertenencia en cada operación.
    app.use('/api/inmuebles', (req, res, siguiente) => {
        const claims = claimsDe(req);
        if (!claims) {
            return res.status(401).json({ mensaje: 'Acceso denegado. No se proporcionó un token.' });
        }
        if (!(claims.roles || []).includes('PROPIETARIO')) {
            return res
                .status(403)
                .json({ mensaje: 'Acceso restringido. Se requiere rol de propietario.' });
        }
        req.claims = claims;
        return siguiente();
    });

    const MENSAJE_NO_ENCONTRADO = 'Inmueble no encontrado o no tienes permisos';

    /** El inmueble solo si es de quien pregunta. Igual que el servicio real. */
    const propioDe = (id, sub) => {
        const inmueble = inmuebles.get(id);
        return inmueble && inmueble.id_propietario === sub ? inmueble : null;
    };

    app.get('/api/inmuebles', (req, res) =>
        res.json([...inmuebles.values()].filter((i) => i.id_propietario === req.claims.sub))
    );

    app.get('/api/inmuebles/:id', (req, res) => {
        const inmueble = propioDe(req.params.id, req.claims.sub);
        return inmueble
            ? res.json(inmueble)
            : res.status(404).json({ mensaje: MENSAJE_NO_ENCONTRADO });
    });

    app.post('/api/inmuebles', (req, res) => {
        const { direccion, tipo, ...resto } = req.body || {};

        if (!TIPOS.includes(tipo)) {
            return res
                .status(400)
                .json({ mensaje: `El tipo de inmueble debe ser uno de: ${TIPOS.join(', ')}` });
        }
        if (typeof direccion !== 'string' || direccion.trim() === '') {
            return res.status(400).json({ mensaje: 'La dirección es obligatoria' });
        }

        // `id_propietario` y `estado` no se aceptan del cuerpo, igual que en el real.
        delete resto.id_propietario;
        delete resto.estado;

        const inmueble = {
            id_inmueble: crypto.randomUUID(),
            direccion,
            tipo,
            ...resto,
            estado: 'disponible',
            id_propietario: req.claims.sub,
            creado_por: req.claims.sub,
            actualizado_por: req.claims.sub,
            fecha_creacion: new Date().toISOString(),
            ultima_actualizacion: new Date().toISOString()
        };

        inmuebles.set(inmueble.id_inmueble, inmueble);
        return res.status(201).json({ mensaje: 'Inmueble creado exitosamente', inmueble });
    });

    app.put('/api/inmuebles/:id', (req, res) => {
        const inmueble = propioDe(req.params.id, req.claims.sub);
        if (!inmueble) return res.status(404).json({ mensaje: MENSAJE_NO_ENCONTRADO });

        const { id_propietario, estado, id_inmueble, ...cambios } = req.body || {};

        if ('tipo' in cambios && !TIPOS.includes(cambios.tipo)) {
            return res
                .status(400)
                .json({ mensaje: `El tipo de inmueble debe ser uno de: ${TIPOS.join(', ')}` });
        }

        Object.assign(inmueble, cambios, { actualizado_por: req.claims.sub });
        return res.json({ mensaje: 'Inmueble actualizado', inmueble });
    });

    app.delete('/api/inmuebles/:id', (req, res) => {
        const inmueble = propioDe(req.params.id, req.claims.sub);
        if (!inmueble) return res.status(404).json({ mensaje: MENSAJE_NO_ENCONTRADO });

        // No comprueba contratos: eso lo veta el guardia del gateway, y que este
        // doble tampoco lo haga es justamente lo que permite comprobarlo.
        inmuebles.delete(inmueble.id_inmueble);
        return res.json({ mensaje: 'Inmueble eliminado' });
    });

    // ── /interno ────────────────────────────────────────────────────────────
    // El doble EXIGE la credencial de servicio, igual que el real.
    app.use(
        '/interno',
        exigirServicio({
            destinatario: 'ms-inmuebles',
            secreto: opciones.secretoServicio || process.env.SERVICIO_JWT_SECRET
        })
    );

    app.get('/interno/inmuebles', (req, res) => {
        const { propietario, ids } = req.query;

        if (typeof propietario === 'string' && propietario !== '') {
            return res.json({
                inmuebles: [...inmuebles.values()].filter((i) => i.id_propietario === propietario)
            });
        }

        if (typeof ids === 'string') {
            return res.json({
                inmuebles: ids
                    .split(',')
                    .map((id) => inmuebles.get(id.trim()))
                    .filter(Boolean)
            });
        }

        return res.status(400).json({ mensaje: 'Indica `propietario` o `ids`' });
    });

    app.post('/interno/inmuebles/:id/estado', (req, res) => {
        const { estado, solicitado_por: solicitadoPor } = req.body || {};

        if (!ESTADOS.includes(estado)) {
            return res.status(400).json({ mensaje: 'Estado no válido' });
        }

        const inmueble = inmuebles.get(req.params.id);
        if (!inmueble) return res.status(404).json({ mensaje: 'Inmueble no encontrado' });

        inmueble.estado = estado;
        if (solicitadoPor) inmueble.actualizado_por = solicitadoPor;

        return res.json({ mensaje: 'Estado actualizado', inmueble });
    });

    const servidor = await new Promise((resolver) => {
        const s = app.listen(0, '127.0.0.1', () => resolver(s));
    });

    return {
        url: `http://127.0.0.1:${servidor.address().port}`,
        inmuebles,
        llamadas,
        /**
         * Hace fallar las peticiones, para probar la política de fallo del cliente.
         *
         * `patron` permite tirar SOLO una parte del servicio, que es lo que hace
         * falta para probar el caso del ADR 0011: el inmueble se puede consultar
         * pero su estado no se puede escribir.
         */
        caer: (codigo = 503, patron = null) => {
            fallarCon = codigo;
            fallarSolo = patron;
        },
        levantar: () => {
            fallarCon = null;
            fallarSolo = null;
        },
        cerrar: () =>
            new Promise((resolver, rechazar) => {
                servidor.close((error) => (error ? rechazar(error) : resolver()));
            })
    };
};

module.exports = { ESTADOS, TIPOS, crearInmueblesFalso };
