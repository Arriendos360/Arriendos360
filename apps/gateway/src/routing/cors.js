/**
 * Opciones de CORS del gateway. Con `CORS_ORIGENES` (lista separada por comas)
 * sólo esos orígenes; sin ella, cualquiera.
 */

const { leerEntorno } = require('arriendos360-shared');

/** Opciones para `cors()`, leídas del entorno. */
const opcionesCors = (entorno = process.env) => {
    const origenes = (leerEntorno('CORS_ORIGENES', entorno) || '')
        .split(',')
        .map((origen) => origen.trim())
        .filter(Boolean);

    return origenes.length > 0 ? { origin: origenes } : {};
};

module.exports = { opcionesCors };
