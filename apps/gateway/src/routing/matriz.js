/**
 * Matriz RBAC del gateway: cruza método, ruta y rol. Una ruta de `/api` que no
 * esté declarada se deniega con 403 y no llega a la red interna.
 */

const { ROL_INQUILINO, ROL_PROPIETARIO } = require('arriendos360-shared');

/** Ruta abierta: no exige token. */
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
 */
const MATRIZ = [
    // ── Identidad ──────────────────────────────────────────────────────────
    { metodo: 'POST', patron: '/api/auth/registro', acceso: PUBLICO },
    { metodo: 'POST', patron: '/api/auth/login', acceso: PUBLICO },
    { metodo: 'POST', patron: '/api/auth/logout', acceso: AUTENTICADO },
    { metodo: 'POST', patron: '/api/auth/cambiar-contrasena', acceso: AUTENTICADO },
    // Recuperación de contraseña: pública, quien la usa no puede entrar.
    { metodo: 'POST', patron: '/api/auth/recuperar', acceso: PUBLICO },
    { metodo: 'POST', patron: '/api/auth/restablecer', acceso: PUBLICO },

    // Buscar personas por documento y dar de alta inquilinos.
    { metodo: 'GET', patron: '/api/usuarios/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'POST', patron: '/api/usuarios/**', acceso: SOLO_PROPIETARIO },

    // ── Inmuebles ──────────────────────────────────────────────────────────
    { metodo: 'GET', patron: '/api/inmuebles/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'POST', patron: '/api/inmuebles/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'PUT', patron: '/api/inmuebles/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'DELETE', patron: '/api/inmuebles/**', acceso: SOLO_PROPIETARIO },

    // ── Contratos ──────────────────────────────────────────────────────────
    // Anexos antes que los comodines, que los taparían. Las dos partes leen;
    // sólo el propietario adjunta y borra.
    { metodo: 'GET', patron: '/api/contratos/:id/anexos', acceso: AMBOS },
    { metodo: 'GET', patron: '/api/contratos/:id/anexos/:idAnexo', acceso: AMBOS },
    { metodo: 'POST', patron: '/api/contratos/:id/anexos', acceso: SOLO_PROPIETARIO },
    {
        metodo: 'DELETE',
        patron: '/api/contratos/:id/anexos/:idAnexo',
        acceso: SOLO_PROPIETARIO
    },

    // El inquilino lee su contrato; sólo el propietario lo escribe.
    { metodo: 'GET', patron: '/api/contratos/**', acceso: AMBOS },
    { metodo: 'POST', patron: '/api/contratos/:id/contrasena-inquilino', acceso: SOLO_PROPIETARIO },
    { metodo: 'POST', patron: '/api/contratos/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'PUT', patron: '/api/contratos/**', acceso: SOLO_PROPIETARIO },
    { metodo: 'DELETE', patron: '/api/contratos/**', acceso: SOLO_PROPIETARIO },

    // ── Financiero ─────────────────────────────────────────────────────────
    // El inquilino lee; las escrituras son del propietario.
    { metodo: 'GET', patron: '/api/pagos/**', acceso: AMBOS },
    { metodo: 'POST', patron: '/api/pagos/cuentas-cobro', acceso: SOLO_PROPIETARIO },
    {
        metodo: 'POST',
        patron: '/api/pagos/transacciones/:id/anular',
        acceso: SOLO_PROPIETARIO
    },
    { metodo: 'POST', patron: '/api/pagos/**', acceso: SOLO_PROPIETARIO },

    // ── Dashboard ──────────────────────────────────────────────────────────
    { metodo: 'GET', patron: '/api/dashboard/**', acceso: SOLO_PROPIETARIO }
];

/**
 * Lo único que puede hacer un usuario con cambio de contraseña obligatorio. Se
 * aplica en `rbac.js`, después de autenticar.
 */
const RUTAS_CON_CAMBIO_PENDIENTE = [
    'POST /api/auth/login',
    'POST /api/auth/cambiar-contrasena',
    'POST /api/auth/logout'
];

/** ¿Puede esta petición seguir adelante con el cambio de contraseña pendiente? */
const permitidaConCambioPendiente = (metodo, ruta) =>
    RUTAS_CON_CAMBIO_PENDIENTE.includes(`${metodo} ${ruta}`);

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

/** Resumen multilínea de la matriz vigente, para registrar al arrancar. */
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
    RUTAS_CON_CAMBIO_PENDIENTE,
    SOLO_PROPIETARIO,
    compilarPatron,
    describirAcceso,
    describirMatriz,
    esRutaDeApi,
    lineasMatriz,
    permitidaConCambioPendiente,
    resolverPolitica
};
