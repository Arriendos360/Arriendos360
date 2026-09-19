/**
 * Cliente del gateway hacia ms-identidad.
 *
 * Un solo uso: traer lo que invalida tokens para la caché de revocados
 * (`routing/cacheRevocados.js`). Ver `docs/adr/0008`.
 */

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

/**
 * Petición GET a un endpoint `/interno`, firmada y con tiempo límite.
 *
 * La credencial se firma en cada llamada en vez de reutilizarla: el token dura
 * un minuto, así que cachearlo ahorraría una firma HMAC —microsegundos— a cambio
 * de tener que gestionar su caducidad. No compensa.
 */
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
 * Todo lo que invalida tokens: los `jti` revocados uno a uno y las marcas de
 * cambio de contraseña, que tumban en bloque las sesiones de un usuario.
 *
 * El fallo SÍ se propaga: quien llama es el refresco de la caché, y necesita
 * distinguir entre «no hay nada» y «no pude preguntar». Confundir las dos cosas
 * dejaría entrar tokens cerrados.
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
