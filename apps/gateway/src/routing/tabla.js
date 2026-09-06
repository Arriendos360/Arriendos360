/**
 * Tabla de enrutamiento del gateway.
 *
 * Declara, por cada prefijo de la API, si se resuelve en modo LOCAL (el codigo
 * del monolito que vive en este mismo proceso) o REMOTO (reenvio HTTP al
 * microservicio ya extraido).
 *
 * El modo no se configura a mano: se deriva de si la variable de entorno con la
 * URL del servicio esta definida y no vacia. Asi, extraer un servicio es
 * poner su URL en el entorno, sin tocar codigo ni redesplegar el gateway con
 * otra bandera.
 *
 * Hoy las cuatro variables estan vacias, de modo que los seis prefijos resuelven
 * en LOCAL y el comportamiento es identico al de antes de esta costura.
 */

const MODO_LOCAL = 'local';
const MODO_REMOTO = 'remoto';

/**
 * Un prefijo con `variableEntorno: null` es estructuralmente local: no existe un
 * microservicio al que reenviarlo.
 *
 * - `/api/dashboard` vive en el gateway por diseno (regla dura 5): no tiene
 *   tablas propias, solo agrega respuestas de Contratos y Financiero.
 * - `/api/admin` son utilidades de operacion del monolito, fuera del catalogo
 *   de servicios del Capitulo 2.
 */
const TABLA_RUTAS = [
    { prefijo: '/api/auth', servicio: 'ms-identidad', variableEntorno: 'MS_IDENTIDAD_URL' },
    { prefijo: '/api/inmuebles', servicio: 'ms-inmuebles', variableEntorno: 'MS_INMUEBLES_URL' },
    { prefijo: '/api/contratos', servicio: 'ms-contratos', variableEntorno: 'MS_CONTRATOS_URL' },
    { prefijo: '/api/pagos', servicio: 'ms-financiero', variableEntorno: 'MS_FINANCIERO_URL' },
    { prefijo: '/api/dashboard', servicio: null, variableEntorno: null },
    { prefijo: '/api/admin', servicio: null, variableEntorno: null }
];

/**
 * Devuelve la URL de destino configurada para una entrada, o null si el prefijo
 * debe resolverse localmente.
 *
 * Una variable definida pero vacia (`MS_AUTH_URL=`) cuenta como no configurada:
 * es justo como quedan en `.env.example` mientras no exista el servicio.
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
 * Una linea por prefijo, con su modo resuelto y, si es remoto, la URL de destino.
 *
 * En modo local dice ademas por que: si el prefijo tiene variable de entorno,
 * nombra cual falta por definir; si no la tiene, que es local por diseno. Esa
 * pista ahorra el rato de depuracion clasico de "puse la URL y sigue yendo al
 * monolito" cuando en realidad la variable estaba mal escrita.
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
