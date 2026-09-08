/**
 * Doble de ms-contratos para las pruebas del gateway.
 *
 * Mismo razonamiento que los de identidad e inmuebles: la costura reenvía por
 * red, así que para probar el gateway hace falta algo que escuche. Un mock de
 * función no ejercitaría ni el reenvío, ni la credencial de servicio, ni la
 * política de fallo del cliente.
 *
 * ── ESTE DOBLE TIENE QUE HACER ALGO QUE LOS OTROS NO ────────────────────────
 *
 * Resuelve la PERTENENCIA, que es la razón de ser del `/interno` del servicio
 * real. Y la resuelve como el real: consultando quién es el dueño de cada
 * inmueble, no adivinándolo. Por eso recibe el doble de inmuebles al crearse y
 * mira su mapa.
 *
 * No es un detalle de comodidad. Si el doble decidiera la pertenencia con una
 * regla propia —por ejemplo, guardando un `id_propietario` en el contrato— las
 * suites pasarían en verde contra un comportamiento que el servicio real no
 * tiene, y taparían justo la decisión que el paso 6d tomó: que el propietario NO
 * se denormaliza y se pregunta cada vez. Ver `docs/adr/0017`.
 *
 * ── Y COMPONE LA RESPUESTA, PORQUE EL SERVICIO REAL LA COMPONE ─────────────
 *
 * `GET /api/contratos` devuelve cada contrato con su `Inmueble` y su
 * `Inquilino` dentro, que es lo que la SPA lee. El doble hace lo mismo, con los
 * datos de los otros dos dobles: si devolviera el contrato pelado, la suite que
 * comprueba esa composición pasaría a comprobar nada.
 *
 * ── Y EMITE LOS EVENTOS, PORQUE AHORA ES EL PRODUCTOR ───────────────────────
 *
 * Firmar un contrato contra este doble anota el sobre en una bandeja en memoria.
 * Las suites que comprueban la cadena completa —firmar, entregar, ver el
 * inmueble arrendado— entregan esos sobres al doble de inmuebles con
 * `entregarEventos()`. Es el equivalente del publicador real, sin temporizador.
 *
 * Lo que el doble NO prueba es que el contrato entre los dos sea cierto. De eso
 * se encarga la suite de integración contra el stack real.
 */

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { exigirServicio } = require('arriendos360-shared');

const ESTADO_ACTIVO = 'activo';
const ESTADO_FINALIZADO = 'finalizado';

/**
 * @param {object} opciones
 * @param {object} opciones.inmuebles el doble de ms-inmuebles, para resolver la
 *   pertenencia. Sin él, este doble no puede decir de quién es un contrato — que
 *   es exactamente la situación del servicio real.
 */
const crearContratosFalso = async (opciones = {}) => {
    const secreto = opciones.secreto || process.env.JWT_SECRET;
    const dobleInmuebles = opciones.inmuebles || null;
    const dobleIdentidad = opciones.identidad || null;

    /** @type {Map<string, object>} contratos por id */
    const contratos = new Map();
    /** @type {Map<string, object>} anexos por id */
    const anexos = new Map();
    /** Sobres anotados en la bandeja de salida, pendientes de entregar. */
    const salida = [];
    /** Peticiones recibidas, para que una prueba pueda afirmar sobre ellas. */
    const llamadas = [];
    /** Si se pone, las peticiones que casen fallan con este código. */
    let fallarCon = null;
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

    // ── Pertenencia ─────────────────────────────────────────────────────────
    // Igual que el servicio real: se le pregunta a Inmuebles de quién es el
    // inmueble. NO hay `id_propietario` en el contrato.
    const inmueblesDe = (sub) => {
        if (!dobleInmuebles) return [];
        return [...dobleInmuebles.inmuebles.values()]
            .filter((i) => i.id_propietario === sub)
            .map((i) => i.id_inmueble);
    };

    const esPropietarioDe = (contrato, sub) => inmueblesDe(sub).includes(contrato.id_inmueble);

    const esParteDe = (contrato, sub) =>
        contrato.id_inquilino === sub || esPropietarioDe(contrato, sub);

    // ── Composición ─────────────────────────────────────────────────────────
    // El servicio real adjunta `Inmueble` e `Inquilino` a lo que sale por
    // `/api/contratos`. Aquí se hace lo mismo con los otros dos dobles, y con la
    // misma degradación: lo que no esté queda en `null`.
    const comoUsuario = (usuario) =>
        usuario
            ? {
                  id_usuario: usuario.id,
                  nombres: usuario.nombres,
                  apellidos: usuario.apellidos,
                  documento: usuario.documento,
                  telefono: usuario.telefono,
                  email: usuario.email
              }
            : null;

    const conPartes = (contrato) => ({
        ...contrato,
        Inmueble:
            (dobleInmuebles && dobleInmuebles.inmuebles.get(contrato.id_inmueble)) || null,
        Inquilino: comoUsuario(
            dobleIdentidad && dobleIdentidad.usuarios.get(contrato.id_inquilino)
        )
    });

    /** Anota un sobre en la bandeja de salida, como haría el outbox real. */
    const anotarEvento = (tipo, contrato) => {
        salida.push({
            id_evento: crypto.randomUUID(),
            tipo,
            version: 1,
            ocurrido_en: new Date().toISOString(),
            clave_orden: contrato.id_inmueble,
            payload:
                tipo === 'ContratoFormalizado'
                    ? {
                          id_contrato: contrato.id_contrato,
                          id_inmueble: contrato.id_inmueble,
                          canon: Number(contrato.canon),
                          fecha_inicio_corte: contrato.fecha_inicio_corte
                      }
                    : {
                          id_contrato: contrato.id_contrato,
                          id_inmueble: contrato.id_inmueble
                      }
        });
    };

    // ── /api/contratos ──────────────────────────────────────────────────────
    app.use('/api/contratos', (req, res, siguiente) => {
        const claims = claimsDe(req);
        if (!claims) {
            return res.status(401).json({ mensaje: 'Acceso denegado. No se proporcionó un token.' });
        }
        req.claims = claims;
        return siguiente();
    });

    const soloPropietario = (req, res, siguiente) => {
        if (!(req.claims.roles || []).includes('PROPIETARIO')) {
            return res
                .status(403)
                .json({ mensaje: 'Acceso restringido. Se requiere rol de propietario.' });
        }
        return siguiente();
    };

    const NO_ENCONTRADO = { mensaje: 'Contrato no encontrado o no tienes permisos' };

    app.get('/api/contratos', (req, res) => {
        // Si el doble de inmuebles está caído, la pertenencia no se puede
        // resolver y el servicio real responde 502. Aquí igual: es la diferencia
        // entre autorizar —que propaga— y decorar, que degrada.
        if (dobleInmuebles && dobleInmuebles.estaCaido && dobleInmuebles.estaCaido()) {
            return res
                .status(502)
                .json({ mensaje: 'No se pudo contactar el servicio de inmuebles' });
        }

        return res.json(
            [...contratos.values()].filter((c) => esParteDe(c, req.claims.sub)).map(conPartes)
        );
    });

    // Los anexos van ANTES de `/:id`, igual que en el servicio real.
    app.get('/api/contratos/:id/anexos', (req, res) => {
        const contrato = contratos.get(req.params.id);
        if (!contrato || !esParteDe(contrato, req.claims.sub)) {
            return res.status(404).json(NO_ENCONTRADO);
        }
        return res.json(
            [...anexos.values()].filter((a) => a.id_contrato === contrato.id_contrato)
        );
    });

    app.get('/api/contratos/:id', (req, res) => {
        const contrato = contratos.get(req.params.id);
        if (!contrato || !esParteDe(contrato, req.claims.sub)) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado' });
        }
        return res.json(conPartes(contrato));
    });

    app.post('/api/contratos', soloPropietario, (req, res) => {
        const cuerpo = req.body || {};
        const { id_inmueble, id_inquilino, inicio, fin, canon } = cuerpo;

        if (!inmueblesDe(req.claims.sub).includes(id_inmueble)) {
            return res.status(403).json({ mensaje: 'No tienes permisos sobre este inmueble' });
        }
        if (new Date(fin) <= new Date(inicio)) {
            return res
                .status(400)
                .json({ mensaje: 'La fecha de fin debe ser posterior a la de inicio' });
        }
        if (parseFloat(canon) <= 0) {
            return res.status(400).json({ mensaje: 'El canon debe ser un número positivo' });
        }

        // El inquilino tiene que existir y tener ese rol. Es lo que hace el
        // servicio real preguntándole a ms-identidad, y lo que convierte una
        // cédula vieja en `id_inquilino` en un 404 y no en un 500.
        const usuario = dobleIdentidad ? dobleIdentidad.usuarios.get(id_inquilino) : null;

        if (!usuario || !(usuario.roles || []).includes('INQUILINO')) {
            return res.status(404).json({
                mensaje: 'Inquilino no encontrado',
                error_code: 'TENANT_NOT_FOUND',
                id_inquilino
            });
        }

        const fechaInicioCorte =
            cuerpo.fecha_inicio_corte || new Date(inicio).toISOString().slice(0, 10);

        const contrato = {
            id_contrato: crypto.randomUUID(),
            ...cuerpo,
            fecha_inicio_corte: fechaInicioCorte,
            fecha_limite_pago:
                cuerpo.fecha_limite_pago !== undefined && cuerpo.fecha_limite_pago !== ''
                    ? Number(cuerpo.fecha_limite_pago)
                    : Number(fechaInicioCorte.slice(8, 10)),
            id_inquilino,
            estado: cuerpo.estado || ESTADO_ACTIVO,
            creado_por: req.claims.sub,
            actualizado_por: req.claims.sub,
            fecha_creacion: new Date().toISOString(),
            ultima_actualizacion: new Date().toISOString()
        };

        contratos.set(contrato.id_contrato, contrato);
        // El evento se anota al guardar, como en el servicio real.
        anotarEvento('ContratoFormalizado', contrato);

        return res.status(201).json({ mensaje: 'Contrato creado exitosamente', contrato });
    });

    app.put('/api/contratos/:id/finalizar', soloPropietario, (req, res) => {
        const contrato = contratos.get(req.params.id);
        if (!contrato || !esPropietarioDe(contrato, req.claims.sub)) {
            return res.status(404).json(NO_ENCONTRADO);
        }

        contrato.estado = ESTADO_FINALIZADO;
        contrato.actualizado_por = req.claims.sub;
        anotarEvento('ContratoFinalizado', contrato);

        return res.json({ mensaje: 'Contrato finalizado', contrato });
    });

    app.put('/api/contratos/:id', soloPropietario, (req, res) => {
        const contrato = contratos.get(req.params.id);
        if (!contrato || !esPropietarioDe(contrato, req.claims.sub)) {
            return res.status(404).json(NO_ENCONTRADO);
        }

        const { creado_por, actualizado_por, ...cambios } = req.body || {};
        Object.assign(contrato, cambios, { actualizado_por: req.claims.sub });
        return res.json({ mensaje: 'Contrato actualizado', contrato });
    });

    // ── /interno ────────────────────────────────────────────────────────────
    // El doble EXIGE la credencial de servicio, igual que el real. Sin esto, las
    // suites pasarían aunque el gateway olvidara mandarla.
    app.use(
        '/interno',
        exigirServicio({
            destinatario: 'ms-contratos',
            secreto: opciones.secretoServicio || process.env.SERVICIO_JWT_SECRET
        })
    );

    app.get('/interno/contratos', (req, res) => {
        const { parte, propietario, inquilino, ids, inmueble, estado } = req.query;
        const todos = [...contratos.values()];

        if (parte) {
            return res.json({ contratos: todos.filter((c) => esParteDe(c, parte)) });
        }

        if (propietario) {
            return res.json({ contratos: todos.filter((c) => esPropietarioDe(c, propietario)) });
        }

        if (inquilino) {
            return res.json({ contratos: todos.filter((c) => c.id_inquilino === inquilino) });
        }

        if (inmueble) {
            return res.json({
                contratos: todos.filter(
                    (c) =>
                        c.id_inmueble === inmueble && (!estado || c.estado === estado)
                )
            });
        }

        if (typeof ids === 'string') {
            return res.json({
                contratos: ids
                    .split(',')
                    .map((id) => contratos.get(id.trim()))
                    .filter(Boolean)
            });
        }

        if (estado) {
            return res.json({ contratos: todos.filter((c) => c.estado === estado) });
        }

        return res.status(400).json({ mensaje: 'Indica un filtro' });
    });

    app.get('/interno/contratos/:id', (req, res) => {
        const contrato = contratos.get(req.params.id);
        const { propietario } = req.query;

        if (!contrato) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado' });
        }

        if (propietario && !esPropietarioDe(contrato, propietario)) {
            return res.status(404).json({ mensaje: 'Contrato no encontrado' });
        }

        return res.json({ contrato });
    });

    const servidor = await new Promise((resolver) => {
        const s = app.listen(0, '127.0.0.1', () => resolver(s));
    });

    return {
        url: `http://127.0.0.1:${servidor.address().port}`,
        anexos,
        contratos,
        llamadas,
        salida,
        /** Limpia el registro de llamadas, para afirmar sobre un tramo concreto. */
        limpiarLlamadas: () => {
            llamadas.length = 0;
        },
        /**
         * Entrega lo que hay en la bandeja al consumidor que se le pase.
         *
         * Es el publicador de las pruebas: sin temporizador y sin esperas, para
         * que «todavía no se ha entregado» siga siendo una afirmación
         * comprobable y no una carrera.
         */
        vaciarSalida: () => salida.splice(0, salida.length),
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

module.exports = { ESTADO_ACTIVO, ESTADO_FINALIZADO, crearContratosFalso };
