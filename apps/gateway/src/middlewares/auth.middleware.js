const jwt = require('jsonwebtoken');

const { ROL_PROPIETARIO } = require('../models/constantes');
const { estaRevocado } = require('../services/tokenService');

const MENSAJE_SIN_TOKEN = 'Acceso denegado. No se proporcionó un token.';
const MENSAJE_TOKEN_INVALIDO = 'Token no válido o expirado.';
const MENSAJE_TOKEN_REVOCADO = 'Sesión cerrada. Inicia sesión de nuevo.';
const MENSAJE_ROL_INSUFICIENTE = 'Acceso restringido. Se requiere rol de propietario.';

/**
 * Extrae el token del esquema `Authorization: Bearer <token>`.
 *
 * Ya NO acepta `?token=`. Ese atajo existía para `window.open`, que no puede
 * poner cabeceras; ahora las descargas de PDF se piden con `fetch` y se
 * disparan como blob, así que el parámetro sobra. Es una mejora de seguridad
 * real: un token en la query string queda en los logs del servidor, en el
 * historial del navegador y en la cabecera `Referer`.
 */
const extraerToken = (req) => {
    const cabecera = req.headers['authorization'];
    if (!cabecera) {
        return null;
    }

    const [esquema, valor] = cabecera.split(' ');
    if (!valor || esquema.toLowerCase() !== 'bearer') {
        return null;
    }

    return valor;
};

/**
 * Valida firma, vigencia y revocación del token.
 *
 * Códigos, según la convención del proyecto:
 *   401  no hay token, o el token está revocado
 *   403  firma inválida o token expirado
 */
const verificarToken = async (req, res, next) => {
    const token = extraerToken(req);

    if (!token) {
        return res.status(401).json({ mensaje: MENSAJE_SIN_TOKEN });
    }

    let verificado;
    try {
        verificado = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(403).json({ mensaje: MENSAJE_TOKEN_INVALIDO });
    }

    // Un token sin `jti` es de la forma anterior a este paso: no se puede
    // revocar, así que no se acepta. Todos los tokens vivos caducan en una hora.
    if (!verificado.jti || !Array.isArray(verificado.roles)) {
        return res.status(403).json({ mensaje: MENSAJE_TOKEN_INVALIDO });
    }

    if (await estaRevocado(verificado.jti)) {
        return res.status(401).json({ mensaje: MENSAJE_TOKEN_REVOCADO });
    }

    req.usuario = verificado;
    next();
};

/** ¿Tiene el usuario autenticado alguno de estos roles? */
const tieneRol = (usuario, ...roles) =>
    Boolean(usuario) &&
    Array.isArray(usuario.roles) &&
    roles.some((rol) => usuario.roles.includes(rol));

/**
 * Exige el rol PROPIETARIO.
 *
 * El rol dejó de ser una columna del usuario y pasó a ser una fila en
 * `RolesUsuario`, así que la comprobación consulta el arreglo de claims. Un
 * usuario que sea propietario e inquilino a la vez pasa por aquí.
 */
const esPropietario = (req, res, next) => {
    if (tieneRol(req.usuario, ROL_PROPIETARIO)) {
        return next();
    }

    return res.status(403).json({ mensaje: MENSAJE_ROL_INSUFICIENTE });
};

module.exports = {
    MENSAJE_ROL_INSUFICIENTE,
    MENSAJE_SIN_TOKEN,
    MENSAJE_TOKEN_INVALIDO,
    MENSAJE_TOKEN_REVOCADO,
    esPropietario,
    extraerToken,
    tieneRol,
    verificarToken
};
