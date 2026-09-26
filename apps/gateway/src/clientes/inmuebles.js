/**
 * Cliente del gateway hacia ms-inmuebles.
 * - `dePropietario` alimenta cifras: propaga el fallo.
 * - `porIds` decora listados: ante un fallo devuelve un mapa vacío.
 */

const { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } = require('arriendos360-shared');

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_INMUEBLES_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-inmuebles';

/** URL base del servicio, o null si todavía no está configurado. */
const urlBase = (entorno = process.env) => {
    const valor = entorno.MS_INMUEBLES_URL;
    if (typeof valor !== 'string') {
        return null;
    }

    const limpio = valor.trim();
    return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/** GET a `/interno` con credencial de servicio. Todo lo de aquí son consultas. */
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
        throw new Error(`ms-inmuebles respondió ${respuesta.status} a ${url}`);
    }

    return respuesta.json();
};

/**
 * Los inmuebles de un propietario.
 *
 * @returns {Promise<Array<object>>}
 * @throws si el servicio no responde.
 */
const dePropietario = async (sub, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

    if (base === null) {
        return [];
    }

    const datos = await pedirJson(
        `${base}/interno/inmuebles?propietario=${encodeURIComponent(sub)}`
    );

    return datos.inmuebles || [];
};

/**
 * Datos de varios inmuebles, indexados por id, en una sola petición.
 *
 * @returns {Promise<Map<string, object>>} vacío si el servicio no responde.
 */
const porIds = async (ids, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
    const unicos = [...new Set((ids || []).filter(Boolean))];

    if (base === null || unicos.length === 0) {
        return new Map();
    }

    try {
        const datos = await pedirJson(
            `${base}/interno/inmuebles?ids=${encodeURIComponent(unicos.join(','))}`
        );

        return new Map((datos.inmuebles || []).map((inmueble) => [inmueble.id_inmueble, inmueble]));
    } catch (error) {
        // Se registra pero no se propaga: esto es decorar, no autorizar.
        console.error('⚠️  No se pudieron obtener inmuebles de ms-inmuebles:', error.message);
        return new Map();
    }
};

/** Estados, para no repetir literales por los controladores. */
const ESTADO_DISPONIBLE = 'disponible';
const ESTADO_ARRENDADO = 'arrendado';

module.exports = {
    ESTADO_ARRENDADO,
    ESTADO_DISPONIBLE,
    TIEMPO_LIMITE_MS,
    dePropietario,
    porIds,
    urlBase
};
