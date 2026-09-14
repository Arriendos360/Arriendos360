/**
 * Cliente del gateway hacia ms-financiero.
 *
 * Existe por una sola razón: **el dashboard**. Es lo único que le queda al
 * gateway que necesite mirar cuentas de cobro, y vive aquí por diseño (regla
 * dura 5): agrega datos de tres contextos y no tiene tablas propias.
 *
 * Hasta el paso 6e las cuentas de cobro eran del gateway y el dashboard las
 * contaba con un `findAll` local. Con la extracción dejaron de estarlo, y el
 * `findAll` se convierte en esto.
 *
 * ── AQUÍ TODO PROPAGA. NO HAY POLÍTICA DOBLE ────────────────────────────────
 *
 * Los otros dos clientes del gateway distinguen dos usos —autorizar, que
 * propaga, y decorar, que degrada— y éste no lo hace: **degrada nunca**.
 *
 * El motivo no es que esto autorice, porque no autoriza. Es que un dashboard
 * degradado MIENTE. Si la petición falla y se devuelve un mapa vacío, la
 * pantalla dice «$0 de ingresos, 0 cuentas en mora» — que no es un hueco visible
 * como una dirección que falta en un listado, sino una cifra que parece una
 * respuesta y que el propietario va a creer. Un 502 le dice que vuelva luego;
 * un cero le dice que nadie le debe nada.
 *
 * Es la misma razón que ya justificaba propagar en `clientes/contratos.js` y en
 * `clientes/inmuebles.js` para este mismo controlador, y por eso el dashboard
 * responde 502 si falla CUALQUIERA de los tres servicios que compone.
 *
 * ── SE PIDEN HECHOS, NO MÉTRICAS ────────────────────────────────────────────
 *
 * `/interno/cuentas-cobro` devuelve las cuentas con su `saldo_pendiente` ya
 * derivado, y el gateway suma. Podría haber devuelto los totales ya calculados y
 * habrían sido menos bytes, pero entonces ms-financiero tendría que saber qué es
 * un dashboard — y cada cambio de una métrica obligaría a desplegarlo. Ver la
 * cabecera de su `interno.controller.ts`.
 */

const { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } = require('arriendos360-shared');

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_FINANCIERO_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-financiero';

/** URL base del servicio, o null si todavía no está configurado. */
const urlBase = (entorno = process.env) => {
    const valor = entorno.MS_FINANCIERO_URL;
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
        throw new Error(`ms-financiero respondió ${respuesta.status} a ${url}`);
    }

    return respuesta.json();
};

/**
 * Las cuentas de cobro de esos contratos, con `saldo_pendiente` derivado.
 *
 * @param {string[]} idsContratos identificadores de contrato, ya filtrados por
 *   pertenencia: quien llama comprobó antes de qué propietario son.
 * @param {string[]} [estados] filtra por estado; sin esto, todas.
 * @throws si ms-financiero no responde. Ver la nota de cabecera.
 */
const cuentasDeContratos = async (idsContratos, estados = null, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
    const unicos = [...new Set((idsContratos || []).filter(Boolean))];

    // Sin contratos no hay cuentas de cobro, y eso es un HECHO, no una
    // degradación: un propietario sin contratos tiene cero cobros. Se devuelve
    // sin preguntar porque la respuesta ya se conoce.
    if (unicos.length === 0) {
        return [];
    }

    // Sin servicio configurado NO se devuelve una lista vacía: sería la mentira
    // que esta cabecera existe para evitar. Que la URL falte es un error de
    // despliegue, y tiene que verse como tal.
    if (base === null) {
        throw new Error('ms-financiero no está configurado (MS_FINANCIERO_URL vacía)');
    }

    const filtroEstado = estados && estados.length > 0
        ? `&estado=${encodeURIComponent(estados.join(','))}`
        : '';

    const datos = await pedirJson(
        `${base}/interno/cuentas-cobro?contratos=${encodeURIComponent(unicos.join(','))}` +
            filtroEstado
    );

    return (datos && datos.cuentas_cobro) || [];
};

module.exports = { TIEMPO_LIMITE_MS, cuentasDeContratos, urlBase };
