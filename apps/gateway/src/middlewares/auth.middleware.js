/**
 * Guardas de ruta del gateway.
 *
 * La verificación del token ya no vive aquí. La hace el control de acceso
 * (`routing/rbac.js`), que corre antes que cualquier router porque tiene que
 * poder denegar una petición ANTES de que la costura la reenvíe a la red
 * interna. Cuando llega hasta aquí, los claims ya están en `req.usuario`.
 *
 * Lo que queda son dos guardas baratas que los routers declaran y que actúan de
 * red de seguridad: si alguien montara un router sin política en la matriz, o
 * cambiara el orden de los middlewares, estas cortan en vez de dejar pasar.
 *
 * No repiten la verificación: sería un segundo `jwt.verify` y una segunda
 * consulta de revocación por petición, sobre el mismo token y en el mismo
 * instante.
 */

const {
    MENSAJE_ROL_INSUFICIENTE,
    MENSAJE_SIN_TOKEN,
    ROL_PROPIETARIO,
    crearError,
    esPropietario: claimsSonDePropietario
} = require('arriendos360-shared');

/**
 * Exige que el control de acceso ya haya autenticado la petición.
 *
 * Un `req.usuario` ausente en una ruta que declara este middleware significa que
 * la matriz no cubre esa ruta como autenticada. Es un error de configuración,
 * no una petición anónima legítima, y se corta igual.
 */
const verificarToken = (req, res, next) => {
    if (!req.usuario) {
        return res.status(401).json(crearError(MENSAJE_SIN_TOKEN));
    }

    return next();
};

/**
 * Exige el rol PROPIETARIO.
 *
 * La matriz ya lo comprueba para las rutas que lo declaran; esto es la Capa 3
 * del módulo de seguridad, que debe sostenerse sola.
 */
const esPropietario = (req, res, next) => {
    if (claimsSonDePropietario(req.usuario)) {
        return next();
    }

    return res.status(403).json(crearError(MENSAJE_ROL_INSUFICIENTE));
};

module.exports = { ROL_PROPIETARIO, esPropietario, verificarToken };
