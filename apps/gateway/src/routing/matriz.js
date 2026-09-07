/**
 * Matriz de políticas RBAC del gateway.
 *
 * Es la Capa 2 del módulo de seguridad del Capítulo 2: el gateway como *Policy
 * Enforcement Point*. Cruza método HTTP, ruta y rol; si no cuadra, responde 403
 * y **la petición no llega a la red interna**. Por eso vive junto a la costura de
 * enrutamiento y se evalúa antes que ella.
 *
 * DENEGAR POR DEFECTO. Una ruta bajo `/api` que no aparezca aquí se rechaza con
 * 403. No es una precaución teórica: es lo que hace que añadir un endpoint nuevo
 * sin declarar su política falle de forma ruidosa en las pruebas, en vez de
 * quedar abierto en silencio. Fuera de `/api` la matriz no opina: la raíz y
 * `/uploads` los sirve Express directamente.
 *
 * La matriz es declarativa a propósito. Se lee de arriba abajo como una tabla y
 * se imprime tal cual al arrancar, así que el estado real de las políticas se
 * puede auditar sin leer código.
 */

const { ROL_INQUILINO, ROL_PROPIETARIO } = require('arriendos360-shared');

/** Ruta abierta: no exige token. Sólo el login y el registro. */
const PUBLICO = 'publico';

/** Exige token válido y no revocado, pero ningún rol en concreto. */
const AUTENTICADO = 'autenticado';

const AMBOS = [ROL_PROPIETARIO, ROL_INQUILINO];
const SOLO_PROPIETARIO = [ROL_PROPIETARIO];

/**
 * Políticas, en orden de evaluación: gana la primera que case.
 *
 * Sintaxis de `patron`:
 *   `:algo`  un segmento cualquiera (`/api/inmuebles/:id`)
 *   `/**`    esta ruta y todo lo que cuelgue de ella
 *
 * Nota sobre `/api/contratos` y `/api/pagos`: los comodines de método cubren
 * `/:id/finalizar` y `/:id/anexos`, que el enunciado pedía explícitamente. No se
 * declaran aparte para no repetir filas con el mismo resultado; hay pruebas que
 * los nombran una por una.
 */
const MATRIZ = [
    // ── Identidad ──────────────────────────────────────────────────────────
    { metodo: 'POST', patron: '/api/auth/registro', acceso: PUBLICO },
    { metodo: 'POST', patron: '/api/auth/login', acceso: PUBLICO },
    { metodo: 'POST', patron: '/api/auth/logout', acceso: AUTENTICADO },

    // Buscar personas por documento y dar de alta inquilinos son operaciones de
    // un propietario en curso de firmar un contrato.
    { metodo: 'GET', patron: '/api/usuarios/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'POST', patron: '/api/usuarios/**', acceso: SOLO_PROPIETARIO },

    // ── Inmuebles ──────────────────────────────────────────────────────────
    // Todo el recurso es del propietario: un inquilino no tiene nada que hacer
    // aquí, ni siquiera leyendo.
    { metodo: 'GET', patron: '/api/inmuebles/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'POST', patron: '/api/inmuebles/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'PUT', patron: '/api/inmuebles/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'DELETE', patron: '/api/inmuebles/**', acceso: SOLO_PROPIETARIO },

    // ── Contratos ──────────────────────────────────────────────────────────
    // El inquilino lee su contrato; sólo el propietario lo escribe.
    { metodo: 'GET', patron: '/api/contratos/**', acceso: AMBOS },
    { metodo: 'POST', patron: '/api/contratos/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'PUT', patron: '/api/contratos/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'DELETE', patron: '/api/contratos/**', acceso: SOLO_PROPIETARIO },

    // ── Financiero ─────────────────────────────────────────────────────────
    { metodo: 'GET', patron: '/api/pagos/**', acceso: AMBOS },
    { metodo: 'POST', patron: '/api/pagos/**', acceso: SOLO_PROPIETARIO },
    // El enunciado de la matriz sólo nombraba GET y POST para pagos. Sin esta
    // fila, `PUT /api/pagos/:id/pagar` caería en la denegación por defecto y el
    // registro de abonos dejaría de funcionar para todo el mundo.
    //
    // Es del propietario, no de los dos roles: quien lleva la contabilidad del
    // arriendo es él, y un inquilino registrando su propio pago sería declararlo
    // sin contrapartida. La API lo permitía —la ruta sólo exigía token— aunque
    // la SPA nunca ofreció el botón al inquilino. Ver docs/adr/0006.
    { metodo: 'PUT', patron: '/api/pagos/:id/pagar', acceso: SOLO_PROPIETARIO },

    // ── Dashboard ──────────────────────────────────────────────────────────
    // Vive en el gateway y agrega datos del propietario (regla dura 5).
    { metodo: 'GET', patron: '/api/dashboard/**', acceso: SOLO_PROPIETARIO }
];

/** Escapa lo que en una ruta podría interpretarse como sintaxis de expresión regular. */
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compila un patrón de ruta a expresión regular.
 *
 * `/api/usuarios/**` casa con `/api/usuarios` y con todo lo que cuelgue.
 * `/api/pagos/:id/pagar` casa con exactamente un segmento en el lugar de `:id`.
 */
const compilarPatron = (patron) => {
    const segmentos = patron.split('/').filter((s) => s !== '');
    let expresion = '^';

    for (const segmento of segmentos) {
        if (segmento === '**') {
            // Cero o más segmentos finales. La ruta base también casa.
            expresion += '(?:/.*)?';
            return new RegExp(`${expresion}$`);
        }

        expresion += segmento.startsWith(':') ? '/[^/]+' : `/${escapar(segmento)}`;
    }

    return new RegExp(`${expresion}$`);
};

// Se compilan una sola vez, al cargar el módulo: la matriz no cambia en caliente.
const MATRIZ_COMPILADA = MATRIZ.map((politica) => ({
    ...politica,
    expresion: compilarPatron(politica.patron)
}));

/**
 * Busca la política que gobierna una petición.
 *
 * @returns la política, o `null` si la ruta no está declarada (que significa
 *   denegar, no permitir).
 */
const resolverPolitica = (metodo, ruta) =>
    MATRIZ_COMPILADA.find(
        (politica) => politica.metodo === metodo && politica.expresion.test(ruta)
    ) || null;

/** ¿Gobierna la matriz esta ruta? Sólo manda dentro de `/api`. */
const esRutaDeApi = (ruta) => ruta === '/api' || ruta.startsWith('/api/');

/** Texto corto del acceso de una política, para el listado de arranque. */
const describirAcceso = (acceso) => {
    if (acceso === PUBLICO) return 'publico';
    if (acceso === AUTENTICADO) return 'autenticado';
    return acceso.join(' + ');
};

const ANCHO_METODO = MATRIZ.reduce((max, p) => Math.max(max, p.metodo.length), 0);
const ANCHO_PATRON = MATRIZ.reduce((max, p) => Math.max(max, p.patron.length), 0);

/** Una línea por política, alineada. */
const lineasMatriz = () =>
    MATRIZ.map(
        (politica) =>
            `${politica.metodo.padEnd(ANCHO_METODO)}  ` +
            `${politica.patron.padEnd(ANCHO_PATRON)}  ${describirAcceso(politica.acceso)}`
    );

/**
 * Resumen multilínea de la matriz vigente, para registrar al arrancar.
 *
 * Se imprime junto al mapa de prefijos locales y remotos: las dos cosas
 * describen cómo se trata una petición y separarlas obligaría a cruzar dos logs
 * para entender qué pasa con una ruta.
 */
const describirMatriz = () => {
    const encabezado =
        `Matriz RBAC (${MATRIZ.length} politicas, denegar por defecto fuera de la lista):`;

    return [encabezado, ...lineasMatriz().map((linea) => `   ${linea}`)].join('\n');
};

module.exports = {
    AMBOS,
    AUTENTICADO,
    MATRIZ,
    PUBLICO,
    SOLO_PROPIETARIO,
    compilarPatron,
    describirAcceso,
    describirMatriz,
    esRutaDeApi,
    lineasMatriz,
    resolverPolitica
};
