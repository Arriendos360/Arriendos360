/**
 * Cliente del gateway hacia ms-contratos.
 *
 * Existe porque los contratos dejaron de ser alcanzables con un `include`. El
 * gateway los necesita para tres cosas que antes resolvía la base de un tirón:
 *
 *   - filtrar las cuentas de cobro y las transacciones de quien pregunta,
 *   - pintar el inmueble y el arrendatario en la pantalla de Pagos y en los PDF,
 *   - recorrer los contratos activos en cada barrido del motor financiero.
 *
 * Todas eran `JOIN` que ahora cruzan la frontera de un servicio. La regla dura 2
 * los prohíbe, así que se piden por HTTP y se componen aquí.
 *
 * ── DOS USOS, DOS POLÍTICAS DE FALLO ────────────────────────────────────────
 *
 * Es la misma distinción que documenta `clientes/inmuebles.js`, y aquí vuelve a
 * decidir lo que pasa cuando el servicio no responde:
 *
 * **Autorizar** — «¿qué contratos son de este usuario?», «¿este contrato es
 * suyo?». Es lo que sustituye a `$Contrato.id_inmueble$` en los `where` de
 * Financiero. Un fallo NO se degrada: devolver una lista vacía haría que un
 * propietario viera «no tienes cobros» en vez de un error, que es una respuesta
 * creíble y falsa. `contratosDondeEsParte` y `propioDe` PROPAGAN.
 *
 * **Decorar** — «dame estos contratos» para pintar un listado o un PDF. Aquí sí
 * se degrada: `porIds` devuelve un mapa vacío y el consumidor pinta lo que
 * pueda. Un recibo sin la dirección sigue siendo un recibo; un 502 al pedirlo,
 * no.
 *
 * ── LA PERTENENCIA NO SE CALCULA AQUÍ ───────────────────────────────────────
 *
 * Y es la diferencia con el cliente de inmuebles. Allí el gateway se trae la
 * lista de identificadores y compara él. Aquí no puede: «este contrato es de
 * este propietario» necesita saber de quién es el inmueble, que está en un
 * tercer servicio. Preguntárselo a los dos y cruzarlo sería una tercera copia de
 * la regla y dos saltos de red donde cabe uno.
 *
 * Así que la responde ms-contratos, que tiene la mitad cara y sabe pedir la
 * otra. Lo que devuelve son HECHOS —estos contratos son suyos— y el código de
 * estado lo sigue eligiendo el gateway. Ver `docs/adr/0017`.
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
 * Los contratos en los que el usuario es PARTE: dueño del inmueble o inquilino.
 *
 * Es la disyunción completa del proyecto, resuelta de una vez por el servicio
 * que tiene los datos. Sustituye al `Op.or` sobre columnas alcanzadas por
 * `include` que CLAUDE.md tenía anotado como decisión abierta.
 *
 * @throws si ms-contratos no responde. Ver la nota de cabecera.
 */
const contratosDondeEsParte = (sub, opciones = {}) =>
    consultar(`parte=${encodeURIComponent(sub)}`, opciones);

/**
 * Sólo los identificadores. Es lo que se pasa como
 * `id_contrato: { [Op.in]: ids }` allí donde antes había un `include` con un
 * `where` sobre el contrato.
 */
const idsDondeEsParte = async (sub, opciones = {}) =>
    (await contratosDondeEsParte(sub, opciones)).map((contrato) => contrato.id_contrato);

/**
 * Los contratos sobre los inmuebles de un propietario.
 *
 * La mitad de propietario de la disyunción. La usa el dashboard, que sólo
 * atiende a propietarios.
 *
 * @throws si ms-contratos no responde.
 */
const contratosDePropietario = (sub, opciones = {}) =>
    consultar(`propietario=${encodeURIComponent(sub)}`, opciones);

/**
 * Los contratos con un estado dado, de todo el sistema.
 *
 * Es el barrido del motor financiero, que no tiene sujeto: recorre los activos
 * para generar las cuentas de cobro del mes. UNA petición por barrido, no una
 * por contrato.
 *
 * @throws si ms-contratos no responde. El motor lo registra y no genera nada
 *   ese ciclo, que es mejor que generar la mitad.
 */
const contratosConEstado = (estado, opciones = {}) =>
    consultar(`estado=${encodeURIComponent(estado)}`, opciones);

/**
 * Los contratos activos de un inmueble.
 *
 * Lo que el guardia de borrado necesita saber, y nada más. La comprobación de
 * pertenencia del inmueble NO es cosa suya: de eso responde ms-inmuebles cuando
 * le llegue el borrado.
 *
 * @throws si ms-contratos no responde. El guardia lo traduce en 500: no se deja
 *   pasar el borrado «por si acaso», porque sería permitir justo lo que existe
 *   para impedir.
 */
const activosDeInmueble = (idInmueble, opciones = {}) =>
    consultar(
        `inmueble=${encodeURIComponent(idInmueble)}&estado=activo`,
        opciones
    );

/**
 * Datos de varios contratos, indexados por id.
 *
 * EN LOTE a propósito: un listado de veinte cuentas de cobro pediría veinte
 * veces lo mismo si la consulta fuera de una en una — el N+1 de siempre, pero
 * con latencia de red.
 *
 * DEGRADA a un mapa vacío: esto es decorar, no autorizar.
 *
 * @returns {Promise<Map<string, object>>}
 */
const porIds = async (ids, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
    const unicos = [...new Set((ids || []).filter(Boolean))];

    if (base === null || unicos.length === 0) {
        return new Map();
    }

    try {
        const datos = await pedirJson(
            `${base}/interno/contratos?ids=${encodeURIComponent(unicos.join(','))}`
        );

        return new Map(
            ((datos && datos.contratos) || []).map((contrato) => [contrato.id_contrato, contrato])
        );
    } catch (error) {
        // Se registra pero no se propaga: esto es decorar, no autorizar.
        console.error('⚠️  No se pudieron obtener contratos de ms-contratos:', error.message);
        return new Map();
    }
};

/** Un contrato, o null. Azúcar sobre `porIds`. DEGRADA. */
const porId = async (id, opciones = {}) => {
    const mapa = await porIds([id], opciones);
    return mapa.get(id) || null;
};

/**
 * Un contrato, SOLO si es sobre un inmueble de este propietario. `null` si no.
 *
 * Es el ABAC que antes resolvía `propioDe(contrato.id_inmueble, sub)` en el
 * gateway, con la diferencia de que ahora son dos preguntas que se hacen en un
 * solo salto: el gateway ya no necesita saber que un contrato tiene inmueble.
 *
 * PROPAGA el fallo, como todo lo que autoriza.
 */
const propioDe = async (idContrato, sub, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

    if (base === null || !idContrato) {
        return null;
    }

    const datos = await pedirJson(
        `${base}/interno/contratos/${encodeURIComponent(idContrato)}` +
            `?propietario=${encodeURIComponent(sub)}`
    );

    return (datos && datos.contrato) || null;
};

/**
 * El contrato si el usuario es parte de él, por cualquiera de las dos vías.
 *
 * Se resuelve con la lista de `contratosDondeEsParte` en vez de con un endpoint
 * propio: el llamante casi siempre necesita después la lista entera —para
 * filtrar sus cuentas de cobro— así que pedirla una vez es más barato que pedir
 * el contrato y después la lista.
 *
 * PROPAGA el fallo.
 */
const parteDe = async (idContrato, sub, opciones = {}) => {
    const contratos = await contratosDondeEsParte(sub, opciones);
    return contratos.find((contrato) => contrato.id_contrato === idContrato) || null;
};

module.exports = {
    TIEMPO_LIMITE_MS,
    activosDeInmueble,
    contratosConEstado,
    contratosDePropietario,
    contratosDondeEsParte,
    idsDondeEsParte,
    parteDe,
    porId,
    porIds,
    propioDe,
    urlBase
};
