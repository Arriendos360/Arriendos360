/**
 * Cliente del gateway hacia ms-inmuebles.
 *
 * DOS USOS, DOS POLÍTICAS DE FALLO. Decide qué se hace cuando el servicio no
 * responde.
 *
 * **Contar** — «¿qué inmuebles tiene este propietario?», para las cifras del
 * dashboard. Un fallo NO puede degradarse: una lista vacía se leería como «0
 * inmuebles», una respuesta creíble y falsa. Por eso `dePropietario` PROPAGA.
 *
 * **Decorar** — «dame los datos de estos inmuebles» para pintar un listado. Aquí
 * sí se degrada: `porIds` devuelve un mapa vacío y el consumidor pinta lo que
 * pueda.
 *
 * Los dos usos son consultas. El estado de ocupación no se escribe por aquí: lo
 * mueven los eventos `ContratoFormalizado` y `ContratoFinalizado`, que consume
 * ms-inmuebles.
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
 * @throws si el servicio no responde. Ver la nota de cabecera.
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
 * Datos de varios inmuebles, indexados por id.
 *
 * En lote a propósito: un listado de veinte contratos pediría veinte veces lo
 * mismo si la consulta fuera de una en una.
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
