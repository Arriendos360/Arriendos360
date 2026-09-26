/**
 * Cliente del gateway hacia ms-financiero, para el dashboard. Nunca degrada: un
 * fallo se propaga, porque un «$0 en mora» mentiría.
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
 *   pertenencia.
 * @param {string[]} [estados] filtra por estado; sin esto, todas.
 * @throws si ms-financiero no responde o no está configurado.
 */
const cuentasDeContratos = async (idsContratos, estados = null, opciones = {}) => {
    const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
    const unicos = [...new Set((idsContratos || []).filter(Boolean))];

    // Sin contratos no hay cuentas: se responde sin preguntar.
    if (unicos.length === 0) {
        return [];
    }

    // Sin URL configurada se lanza en vez de devolver una lista vacía.
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
