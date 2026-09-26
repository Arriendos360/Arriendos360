/**
 * Tabla de enrutamiento: por cada prefijo de la API, si se reenvía a su servicio
 * (remoto, cuando su `MS_*_URL` tiene valor) o se atiende aquí (local).
 */

const MODO_LOCAL = 'local';
const MODO_REMOTO = 'remoto';

/** Prefijos y su servicio. `variableEntorno: null` es siempre local. */
const TABLA_RUTAS = [
    { prefijo: '/api/auth', servicio: 'ms-identidad', variableEntorno: 'MS_IDENTIDAD_URL' },
    { prefijo: '/api/usuarios', servicio: 'ms-identidad', variableEntorno: 'MS_IDENTIDAD_URL' },
    { prefijo: '/api/inmuebles', servicio: 'ms-inmuebles', variableEntorno: 'MS_INMUEBLES_URL' },
    { prefijo: '/api/contratos', servicio: 'ms-contratos', variableEntorno: 'MS_CONTRATOS_URL' },
    { prefijo: '/api/pagos', servicio: 'ms-financiero', variableEntorno: 'MS_FINANCIERO_URL' },
    { prefijo: '/api/dashboard', servicio: null, variableEntorno: null }
];

/**
 * La URL de destino de una entrada, o null si se resuelve localmente. Una
 * variable vacía cuenta como no configurada.
 */
const urlDestino = (entrada, entorno = process.env) => {
    if (!entrada.variableEntorno) {
        return null;
    }

    const valor = entorno[entrada.variableEntorno];
    if (typeof valor !== 'string') {
        return null;
    }

    const limpio = valor.trim();
    return limpio === '' ? null : limpio;
};

/** Modo efectivo de una entrada, segun el entorno actual. */
const modoDe = (entrada, entorno = process.env) =>
    urlDestino(entrada, entorno) === null ? MODO_LOCAL : MODO_REMOTO;

/**
 * Busca la entrada de la tabla que cubre una ruta.
 *
 * La comparacion exige coincidencia de segmento completo: `/api/auth` cubre
 * `/api/auth` y `/api/auth/login`, pero no `/api/authorizaciones`.
 */
const resolverPrefijo = (ruta) =>
    TABLA_RUTAS.find(
        (entrada) => ruta === entrada.prefijo || ruta.startsWith(`${entrada.prefijo}/`)
    ) || null;

/** Ancho del prefijo mas largo, para alinear el listado de arranque. */
const ANCHO_PREFIJO = TABLA_RUTAS.reduce(
    (maximo, entrada) => Math.max(maximo, entrada.prefijo.length),
    0
);

/**
 * Una línea por prefijo con su modo: la URL si es remoto, o por qué es local.
 */
const lineasEnrutamiento = (entorno = process.env) =>
    TABLA_RUTAS.map((entrada) => {
        const prefijo = entrada.prefijo.padEnd(ANCHO_PREFIJO);
        const destino = urlDestino(entrada, entorno);

        if (destino !== null) {
            return `${prefijo}  remoto  ->  ${destino}  (${entrada.servicio})`;
        }

        const motivo =
            entrada.variableEntorno === null
                ? 'siempre local, no tiene servicio propio'
                : `${entrada.variableEntorno} sin definir`;

        return `${prefijo}  local   (${motivo})`;
    });

/**
 * Resumen multilinea del enrutamiento vigente, para registrar al arrancar.
 *
 * Ejemplo:
 * ```
 * Enrutamiento del gateway (6 prefijos):
 *    /api/auth       local   (MS_IDENTIDAD_URL sin definir)
 *    /api/inmuebles  remoto  ->  http://ms-inmuebles:3012  (ms-inmuebles)
 *    /api/dashboard  local   (siempre local, no tiene servicio propio)
 * ```
 */
const describirEnrutamiento = (entorno = process.env) => {
    const remotos = TABLA_RUTAS.filter(
        (entrada) => modoDe(entrada, entorno) === MODO_REMOTO
    ).length;
    const encabezado =
        `Enrutamiento del gateway (${TABLA_RUTAS.length} prefijos, ` +
        `${remotos} remoto${remotos === 1 ? '' : 's'}):`;

    return [encabezado, ...lineasEnrutamiento(entorno).map((linea) => `   ${linea}`)].join(
        '\n'
    );
};

module.exports = {
    MODO_LOCAL,
    MODO_REMOTO,
    TABLA_RUTAS,
    describirEnrutamiento,
    lineasEnrutamiento,
    modoDe,
    resolverPrefijo,
    urlDestino
};
