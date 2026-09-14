/**
 * Opciones de CORS del gateway.
 *
 * Con `CORS_ORIGENES` —una lista separada por comas— sólo esos orígenes pueden llamar
 * a la API desde un navegador. Sin ella, cualquiera, que es lo que conviene en local y
 * en Compose.
 *
 * En Azure se fija al origen de la SPA en Static Web Apps. Es higiene más que barrera:
 * el token viaja en una cabecera y no en una cookie, así que una página de otro origen
 * no hereda la sesión de nadie. Ver `docs/adr/0022`.
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
