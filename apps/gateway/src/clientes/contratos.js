/**
 * Cliente del gateway hacia ms-contratos, para el dashboard y el guardia de
 * borrado. Los fallos se propagan: una lista vacía sería creíble y falsa.
 */

const { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } = require('arriendos360-shared');

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_CONTRATOS_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-contratos';

/** URL base del servicio, o null si todavía no está configurado. */
const urlBase = (entorno = process.env) => {
    const valor = entorno.MS_CONTRATOS_URL;
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

    if (respuesta.status === 404) {
        return null;
    }

    if (!respuesta.ok) {
        throw new Error(`ms-contratos respondió ${respuesta.status} a ${url}`);
    }

    return respuesta.json();
};

/** Consulta con filtros y devuelve la lista. Propaga el fallo. */
const consultar = async (query, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

    if (base === null) {
        return [];
    }

    const datos = await pedirJson(`${base}/interno/contratos?${query}`);
    return (datos && datos.contratos) || [];
};

/**
 * Los contratos sobre los inmuebles de un propietario.
 *
 * @throws si ms-contratos no responde.
 */
const contratosDePropietario = (sub, opciones = {}) =>
    consultar(`propietario=${encodeURIComponent(sub)}`, opciones);

/**
 * Los contratos activos de un inmueble.
 *
 * @throws si ms-contratos no responde.
 */
const activosDeInmueble = (idInmueble, opciones = {}) =>
    consultar(
        `inmueble=${encodeURIComponent(idInmueble)}&estado=activo`,
        opciones
    );

module.exports = {
    TIEMPO_LIMITE_MS,
    activosDeInmueble,
    contratosDePropietario,
    urlBase
};
