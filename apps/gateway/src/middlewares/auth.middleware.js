/**
 * Guardas de ruta del gateway. El token ya lo verificó el control de acceso
 * (`routing/rbac.js`); estas sólo cortan si falta el usuario o el rol.
 */

const {
    MENSAJE_ROL_INSUFICIENTE,
    MENSAJE_SIN_TOKEN,
    ROL_PROPIETARIO,
    crearError,
    esPropietario: claimsSonDePropietario
} = require('arriendos360-shared');

/** Exige que el control de acceso ya haya autenticado la petición. */
const verificarToken = (req, res, next) => {
    if (!req.usuario) {
        return res.status(401).json(crearError(MENSAJE_SIN_TOKEN));
    }

    return next();
};

/** Exige el rol PROPIETARIO. */
const esPropietario = (req, res, next) => {
    if (claimsSonDePropietario(req.usuario)) {
        return next();
    }

    return res.status(403).json(crearError(MENSAJE_ROL_INSUFICIENTE));
};

module.exports = { ROL_PROPIETARIO, esPropietario, verificarToken };
