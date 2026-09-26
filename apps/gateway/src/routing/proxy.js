/**
 * Reenvío HTTP transparente hacia un microservicio, con el cuerpo en streaming
 * (sirve también para multipart). Debe montarse antes de `express.json()`, que
 * consumiría el cuerpo.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const { enteroDeEntorno } = require('arriendos360-shared');

const { CABECERAS_DE_ORIGEN, cabecerasDeOrigen } = require('./origen');

/**
 * Cabeceras salto-a-salto (RFC 7230, sección 6.1): no se propagan a través de un
 * proxy.
 */
const CABECERAS_SALTO_A_SALTO = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
]);

/** Tiempo maximo de espera del servicio de destino. */
const TIMEOUT_POR_DEFECTO_MS = 10000;

/**
 * Copia las cabeceras entrantes sin las de salto-a-salto ni las de origen, añade
 * las de origen del gateway y reescribe `host`.
 */
const construirCabeceras = (cabecerasEntrantes, urlDestino, origen = {}) => {
    const salida = {};

    for (const [nombre, valor] of Object.entries(cabecerasEntrantes)) {
        const minusculas = nombre.toLowerCase();
        if (!CABECERAS_SALTO_A_SALTO.has(minusculas) && !CABECERAS_DE_ORIGEN.has(minusculas)) {
            salida[nombre] = valor;
        }
    }

    Object.assign(salida, origen);
    salida.host = urlDestino.host;
    return salida;
};

/** Responde 502, o corta la conexión si la respuesta ya empezó a transmitirse. */
const responderFalloDeRed = (res, servicio, causa) => {
    if (res.headersSent) {
        res.destroy();
        return;
    }

    console.error(`Fallo al reenviar a ${servicio}:`, causa && causa.message);
    res.status(502).json({
        mensaje: `No se pudo contactar el servicio ${servicio}.`
    });
};

/**
 * Reenvia la peticion actual al servicio de destino y transmite la respuesta.
 *
 * Conserva metodo, ruta, query string, cabeceras, cuerpo, codigo de estado y
 * cabeceras de respuesta. Los fallos de red se traducen a 502.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} urlBase URL del servicio, por ejemplo `http://ms-inmuebles:3012`
 * @param {string} servicio Nombre del servicio: para los mensajes de error y como
 *   audiencia de la IP firmada
 * @param {{ timeoutMs?: number, secretoServicio?: string }} [opciones]
 */
const reenviar = (req, res, urlBase, servicio, opciones = {}) => {
    // `PROXY_TIMEOUT_MS` permite esperar más a un servicio que despierta.
    const timeoutMs = opciones.timeoutMs || enteroDeEntorno('PROXY_TIMEOUT_MS', TIMEOUT_POR_DEFECTO_MS);

    let destino;
    try {
        // `req.originalUrl` conserva la ruta completa y la query string.
        destino = new URL(req.originalUrl, urlBase);
    } catch (error) {
        responderFalloDeRed(res, servicio, error);
        return;
    }

    const cliente = destino.protocol === 'https:' ? https : http;

    const peticion = cliente.request(
        {
            protocol: destino.protocol,
            hostname: destino.hostname,
            port: destino.port,
            path: `${destino.pathname}${destino.search}`,
            method: req.method,
            // La IP se firma aquí, en cada reenvío: nunca se reutiliza entre peticiones.
            headers: construirCabeceras(req.headers, destino, cabecerasDeOrigen(req, servicio, opciones))
        },
        (respuesta) => {
            res.status(respuesta.statusCode);

            for (const [nombre, valor] of Object.entries(respuesta.headers)) {
                if (!CABECERAS_SALTO_A_SALTO.has(nombre.toLowerCase())) {
                    res.setHeader(nombre, valor);
                }
            }

            respuesta.pipe(res);
        }
    );

    peticion.setTimeout(timeoutMs, () => {
        peticion.destroy(new Error(`Tiempo de espera agotado (${timeoutMs} ms)`));
    });

    peticion.on('error', (error) => {
        responderFalloDeRed(res, servicio, error);
    });

    // Si el cliente corta antes de tiempo, no dejamos la peticion saliente viva.
    req.on('aborted', () => {
        peticion.destroy();
    });

    // El cuerpo se transmite sin tocarlo: JSON, urlencoded o multipart, da igual.
    req.pipe(peticion);
};

module.exports = {
    CABECERAS_SALTO_A_SALTO,
    TIMEOUT_POR_DEFECTO_MS,
    construirCabeceras,
    reenviar
};
