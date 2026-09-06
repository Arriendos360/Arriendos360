/**
 * Reenvio HTTP transparente hacia un microservicio.
 *
 * Usa los modulos `http`/`https` de Node y hace streaming del cuerpo con `pipe`,
 * en vez de leerlo en memoria. Esa decision es la que permite soportar
 * `multipart/form-data` sin caso especial: los bytes del PDF de un anexo pasan
 * tal cual, sin que el gateway tenga que parsear el multipart ni volver a
 * componerlo.
 *
 * Por eso este middleware DEBE montarse antes de `express.json()`. Si un parser
 * de cuerpo corre primero, consume el stream y aqui no quedaria nada que
 * reenviar.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Cabeceras salto-a-salto (RFC 7230, seccion 6.1): describen la conexion, no el
 * mensaje, y no deben propagarse a traves de un proxy.
 *
 * `transfer-encoding` se omite tambien para que Node decida el marco de la
 * peticion saliente segun haya o no `content-length`.
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
 * Copia las cabeceras entrantes, quitando las de salto-a-salto y reescribiendo
 * `host` al del destino.
 *
 * `authorization` no recibe trato especial: se copia como cualquier otra, que es
 * justo lo que se necesita para que el servicio destino verifique el token por
 * su cuenta con el secreto compartido.
 */
const construirCabeceras = (cabecerasEntrantes, urlDestino) => {
    const salida = {};

    for (const [nombre, valor] of Object.entries(cabecerasEntrantes)) {
        if (!CABECERAS_SALTO_A_SALTO.has(nombre.toLowerCase())) {
            salida[nombre] = valor;
        }
    }

    salida.host = urlDestino.host;
    return salida;
};

/**
 * Responde 502 siguiendo la convencion de errores del proyecto.
 *
 * Comprueba `headersSent` porque el fallo puede ocurrir despues de haber
 * empezado a transmitir la respuesta del servicio; en ese caso ya no se puede
 * cambiar el codigo de estado y lo unico correcto es cortar la conexion.
 */
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
 * @param {string} servicio Nombre del servicio, solo para mensajes de error
 * @param {{ timeoutMs?: number }} [opciones]
 */
const reenviar = (req, res, urlBase, servicio, opciones = {}) => {
    const timeoutMs = opciones.timeoutMs || TIMEOUT_POR_DEFECTO_MS;

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
            headers: construirCabeceras(req.headers, destino)
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
