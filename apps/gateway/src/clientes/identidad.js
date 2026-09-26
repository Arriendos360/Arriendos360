/** Cliente del gateway hacia ms-identidad: trae lo que invalida tokens. */

const { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } = require('arriendos360-shared');

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_IDENTIDAD_TIMEOUT_MS', 3000);

/** Nombre del servicio al que apunta este cliente, para el `aud` del token. */
const DESTINATARIO = 'ms-identidad';

/** URL base del servicio, o null si todavía no está configurado. */
const urlBase = (entorno = process.env) => {
    const valor = entorno.MS_IDENTIDAD_URL;
    if (typeof valor !== 'string') {
        return null;
    }

    const limpio = valor.trim();
    return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/** GET a un endpoint `/interno`, firmado en cada llamada y con tiempo límite. */
const pedirJson = async (url) => {
    const respuesta = await fetch(url, {
        headers: cabeceraDeServicio({
            emisor: textoDeEntorno('SERVICIO_NOMBRE', 'gateway'),
            destinatario: DESTINATARIO,
            secreto: process.env.SERVICIO_JWT_SECRET
        }),
        signal: AbortSignal.timeout(TIEMPO_LIMITE_MS)
    });

    if (!respuesta.ok) {
        throw new Error(`ms-identidad respondió ${respuesta.status} a ${url}`);
    }

    return respuesta.json();
};

/**
 * Los `jti` revocados y las marcas de cambio de contraseña. Propaga el fallo,
 * para distinguir «no hay nada» de «no pude preguntar».
 */
const revocadosVigentes = async (opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

    if (base === null) {
        return { revocados: [], sesiones: [] };
    }

    const datos = await pedirJson(`${base}/interno/revocados`);
    return { revocados: datos.revocados || [], sesiones: datos.sesiones || [] };
};

module.exports = {
    TIEMPO_LIMITE_MS,
    revocadosVigentes,
    urlBase
};
