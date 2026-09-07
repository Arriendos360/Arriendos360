/**
 * Cliente del gateway hacia ms-identidad.
 *
 * Existe porque los datos de usuario dejaron de ser alcanzables con un
 * `include`. El gateway los necesita para tres cosas que antes resolvía la base
 * de un tirón:
 *
 *   - el nombre del inquilino en el listado y el detalle de contratos,
 *   - el bloque del arrendatario en los recibos y comprobantes en PDF,
 *   - el correo al que el motor financiero avisa de un vencimiento o una mora.
 *
 * Todas eran `JOIN` que cruzaban la frontera del servicio. La regla dura 2 los
 * prohíbe, así que ahora se piden por HTTP y se componen aquí.
 *
 * Dos decisiones que valen la pena:
 *
 * **En lote, siempre.** `usuariosPorIds` acepta una lista. Un listado de veinte
 * contratos pediría veinte veces lo mismo si la consulta fuera de una en una:
 * el N+1 de siempre, pero ahora con latencia de red. Los llamantes recogen todos
 * los identificadores y hacen una sola petición.
 *
 * **Nunca tumba la respuesta.** Si ms-identidad no contesta, `usuariosPorIds`
 * devuelve un mapa vacío en vez de propagar el error. Un contrato sin el nombre
 * del inquilino sigue siendo un contrato útil; un 502 en el listado entero
 * porque el servicio de identidad tosió, no. Los llamantes ya toleran que el
 * usuario no esté (antes podía faltar el `include`), así que la degradación es
 * la que ya sabían manejar.
 */

const { cabeceraDeServicio } = require('arriendos360-shared');

const TIEMPO_LIMITE_MS = Number(process.env.MS_IDENTIDAD_TIMEOUT_MS || 3000);

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
            emisor: process.env.SERVICIO_NOMBRE || 'gateway',
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
 * Datos de varios usuarios, indexados por id.
 *
 * @param {string[]} ids
 * @returns {Promise<Map<string, object>>} mapa id -> usuario. Vacío si el
 *   servicio no está configurado o no responde.
 */
const usuariosPorIds = async (ids, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
    const unicos = [...new Set((ids || []).filter(Boolean))];

    if (base === null || unicos.length === 0) {
        return new Map();
    }

    try {
        const datos = await pedirJson(
            `${base}/interno/usuarios?ids=${encodeURIComponent(unicos.join(','))}`
        );

        return new Map((datos.usuarios || []).map((usuario) => [usuario.id, usuario]));
    } catch (error) {
        // Se registra pero no se propaga: ver la nota de cabecera.
        console.error('⚠️  No se pudieron obtener usuarios de ms-identidad:', error.message);
        return new Map();
    }
};

/** Datos de un usuario, o null. Azúcar sobre `usuariosPorIds`. */
const usuarioPorId = async (id, opciones = {}) => {
    const mapa = await usuariosPorIds([id], opciones);
    return mapa.get(id) || null;
};

/**
 * Los `jti` revocados que siguen vigentes.
 *
 * A diferencia de `usuariosPorIds`, aquí el fallo SÍ se propaga: quien llama es
 * el refresco de la caché, y necesita distinguir entre «no hay revocados» y «no
 * pude preguntar». Confundir las dos cosas dejaría entrar tokens cerrados.
 */
const revocadosVigentes = async (opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

    if (base === null) {
        return [];
    }

    const datos = await pedirJson(`${base}/interno/revocados`);
    return datos.revocados || [];
};

module.exports = { TIEMPO_LIMITE_MS, revocadosVigentes, urlBase, usuarioPorId, usuariosPorIds };
