/**
 * Adaptador Express sobre la verificación de token de `packages/shared`.
 *
 * Hasta este PR aquí vivía una segunda implementación completa de la
 * verificación del JWT, duplicando la de `packages/shared`. No era por gusto: el
 * Dockerfile del gateway construía con contexto `apps/gateway`, así que
 * `packages/` no entraba en la imagen y declarar la dependencia rompía
 * `docker compose up --build`. Con el build en el contexto raíz esa razón
 * desaparece y la duplicación con ella.
 *
 * Lo que queda aquí es sólo lo que es propio de Express: leer la cabecera de
 * `req`, traducir el resultado a `res.status(...).json(...)` y colgar los claims
 * de `req.usuario`. La decisión de si un token vale —firma, vigencia, forma y
 * revocación— vive en `packages/shared` y es la misma que usarán los
 * microservicios cuando se extraigan (regla dura 7, confianza cero).
 *
 * La consulta de revocados se inyecta: el paquete fija que debe filtrar por
 * `expira_en > NOW()`, pero no cómo se resuelve. Hoy la resuelve
 * `tokenService.estaRevocado()` contra `tokens_revocados`; un servicio extraído
 * la resolverá preguntando a MS-Identidad o leyendo su copia en memoria.
 */

const {
    MENSAJE_ROL_INSUFICIENTE,
    ROL_PROPIETARIO,
    crearError,
    esPropietario: claimsSonDePropietario,
    verificarTokenConRevocacion
} = require('arriendos360-shared');

const { estaRevocado } = require('../services/tokenService');

/**
 * Valida firma, vigencia, forma y revocación del token.
 *
 * Códigos, según la convención del proyecto:
 *   401  no hay token, o el token está revocado
 *   403  firma inválida, token expirado o claims con forma antigua
 */
const verificarToken = async (req, res, next) => {
    // El control de acceso ya verificó el token de esta petición y dejó los
    // claims en `req.usuario`. Repetirlo aquí significaría una segunda consulta
    // a `tokens_revocados` por petición sin ganar nada: es el mismo proceso, el
    // mismo token y el mismo instante. Se conserva el middleware porque los
    // routers lo declaran y porque sigue siendo la puerta correcta el día que
    // uno de ellos se monte fuera del gateway.
    if (req.usuario) {
        return next();
    }

    const resultado = await verificarTokenConRevocacion(
        { authorization: req.headers['authorization'] },
        process.env.JWT_SECRET,
        estaRevocado
    );

    if (!resultado.valido) {
        return res.status(resultado.estado).json(resultado.error);
    }

    req.usuario = resultado.claims;
    next();
};

/**
 * Exige el rol PROPIETARIO.
 *
 * El rol dejó de ser una columna del usuario y pasó a ser una fila en
 * `RolesUsuario`, así que la comprobación consulta el arreglo de claims. Un
 * usuario que sea propietario e inquilino a la vez pasa por aquí.
 */
const esPropietario = (req, res, next) => {
    if (claimsSonDePropietario(req.usuario)) {
        return next();
    }

    return res.status(403).json(crearError(MENSAJE_ROL_INSUFICIENTE));
};

module.exports = { ROL_PROPIETARIO, esPropietario, verificarToken };
