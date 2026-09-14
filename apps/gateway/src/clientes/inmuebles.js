/**
 * Cliente del gateway hacia ms-inmuebles.
 *
 * Existe por lo mismo que `identidad.js`: los inmuebles dejaron de ser
 * alcanzables con un `include`. Pero el uso es distinto y la diferencia importa,
 * porque decide qué se hace cuando el servicio no responde.
 *
 * DOS USOS, DOS POLÍTICAS DE FALLO.
 *
 * **Autorizar** — «¿qué inmuebles son de este propietario?». Es lo que sustituye
 * a `$Inmueble.id_propietario$` en los `where` de contratos y pagos. Aquí un
 * fallo NO puede degradarse: si se devolviera una lista vacía, el propietario
 * vería «no tienes contratos» en vez de un error, que es una respuesta creíble y
 * falsa. Peor todavía, la disyunción de visibilidad se reduciría a «eres el
 * inquilino», y un propietario que además es inquilino vería la mitad de sus
 * datos sin enterarse. Por eso `idsDePropietario` PROPAGA el fallo.
 *
 * **Decorar** — «dame los datos de estos inmuebles» para pintar un listado o un
 * PDF. Aquí sí se degrada: `porIds` devuelve un mapa vacío y el consumidor pinta
 * lo que pueda. Un recibo sin la dirección sigue siendo un recibo; un 502 al
 * pedirlo, no. Es la misma política que `usuariosPorIds`.
 *
 * Es la distinción que ya existía entre `usuariosPorIds` y `revocadosVigentes`,
 * aplicada dentro de un solo cliente.
 *
 * LOS DOS USOS SON CONSULTAS, y desde el paso 5 no hay ningún tercero. Escribir
 * en Inmuebles —mover el estado de ocupación— dejó de hacerse por aquí: lo
 * dispara el evento `ContratoFormalizado`. Ver la nota al final del archivo.
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
 * Solo los identificadores de los inmuebles de un propietario.
 *
 * Es lo que se pasa como `id_inmueble: { [Op.in]: ids }` allí donde antes había
 * un `include` con `where: { id_propietario: sub }`.
 *
 * SOBRE EL TAMAÑO DE LA LISTA. CLAUDE.md deja abierto qué pasa cuando un
 * propietario tiene tantos inmuebles que la lista no cabe. Aquí no llega a ser
 * un problema: la lista viaja en el cuerpo de la respuesta —no en una query
 * string— y se usa en un `IN` de SQL contra la base LOCAL del gateway, que es
 * donde siguen viviendo contratos y pagos. El día que Contratos también se
 * extraiga habrá que decidirlo de verdad; hoy no.
 */
const idsDePropietario = async (sub, opciones = {}) =>
    (await dePropietario(sub, opciones)).map((inmueble) => inmueble.id_inmueble);

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

/** Un inmueble, o null. Azúcar sobre `porIds`. */
const porId = async (id, opciones = {}) => {
    const mapa = await porIds([id], opciones);
    return mapa.get(id) || null;
};

/**
 * Un inmueble, SOLO si es de este propietario. `null` en cualquier otro caso.
 *
 * Es el ABAC de pertenencia que antes resolvía un `findOne` con
 * `where: { id_inmueble, id_propietario }`. La comprobación se hace aquí, contra
 * el `id_propietario` que devuelve el servicio, y no pidiéndole al servicio que
 * filtre: así el que autoriza es el gateway, que es quien tiene el `sub`.
 *
 * PROPAGA el fallo, como `idsDePropietario`: no se autoriza a ciegas.
 */
const propioDe = async (id, sub, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

    if (base === null || !id) {
        return null;
    }

    const datos = await pedirJson(`${base}/interno/inmuebles?ids=${encodeURIComponent(id)}`);
    const inmueble = (datos.inmuebles || [])[0];

    return inmueble && inmueble.id_propietario === sub ? inmueble : null;
};

/**
 * NOTA — AQUÍ HABÍA UN `cambiarEstado`.
 *
 * Llamaba a `POST /interno/inmuebles/:id/estado` justo después de guardar el
 * contrato, y era el mecanismo provisional del ADR 0011: dos escrituras sin
 * transacción que las abarcara, con una ventana en la que el contrato existía y
 * el inmueble seguía marcado como libre.
 *
 * El paso 5 lo reemplaza por el evento `ContratoFormalizado`, que se anota en la
 * tabla de salida DENTRO de la transacción del contrato. El endpoint `/interno`
 * que servía a esta función se retiró con él: no le quedaba ningún otro
 * consumidor, y dejarlo en pie habría sido dejar abierta una segunda puerta al
 * estado del inmueble que ya nadie usa pero cualquiera podría volver a usar.
 *
 * Lo que sí sigue aquí es todo lo demás: consultar inmuebles para autorizar y
 * para componer. Eso es síncrono porque es una PREGUNTA, y una pregunta necesita
 * respuesta ahora. Lo que se fue por el bus era una ORDEN, que es justo lo que
 * puede esperar unos segundos.
 */

/** Estados, para no repetir literales por los controladores. */
const ESTADO_DISPONIBLE = 'disponible';
const ESTADO_ARRENDADO = 'arrendado';

module.exports = {
    ESTADO_ARRENDADO,
    ESTADO_DISPONIBLE,
    TIEMPO_LIMITE_MS,
    dePropietario,
    idsDePropietario,
    porId,
    porIds,
    propioDe,
    urlBase
};
