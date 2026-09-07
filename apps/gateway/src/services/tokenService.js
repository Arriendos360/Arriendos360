/**
 * Emisión, verificación y revocación de tokens.
 *
 * Concentra en un solo sitio todo lo que el Capítulo 2 fija sobre el JWT, para
 * que el paso 3b pueda llevárselo a ms-identidad sin ir a buscarlo por los
 * controladores.
 *
 * Claims (sección «Claims del token»):
 *
 *   sub    UUID del usuario
 *   email  correo del usuario
 *   roles  arreglo de strings en mayúsculas: ["PROPIETARIO","INQUILINO"]
 *   jti    UUID único del token, necesario para poder revocarlo
 *   exp    expiración, 3600 segundos
 *
 * Desapareció `id_perfil`, que guardaba la cédula del perfil asociado. Su papel
 * lo hace ahora `sub`, y por eso `Inmuebles.id_propietario` y
 * `Contratos.id_inquilino` pasaron a guardar UUID.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

const TokenRevocado = require('../models/TokenRevocado');
const {
    PRECEDENCIA_ROLES,
    TIPO_TOKEN,
    VIGENCIA_TOKEN_SEGUNDOS
} = require('../models/constantes');

/**
 * Elige el `rol` singular que la respuesta del login expone al frontend.
 *
 * No contradice al arreglo `roles` de los claims: son dos audiencias. Los claims
 * le hablan al gateway y a los servicios, que necesitan la lista completa para
 * autorizar; la respuesta le habla a la SPA, que sólo necesita saber qué barra
 * lateral pintar al entrar.
 */
const rolPrincipal = (roles) =>
    PRECEDENCIA_ROLES.find((candidato) => roles.includes(candidato)) || roles[0] || null;

/**
 * Firma un token para un usuario ya autenticado.
 *
 * Devuelve también `expiracion` como fecha ISO absoluta, porque es lo que la
 * respuesta del login declara y resulta más útil al cliente que los segundos
 * relativos.
 */
const emitirToken = (usuario, roles) => {
    const jti = crypto.randomUUID();

    const token = jwt.sign(
        {
            sub: usuario.id_usuario,
            email: usuario.email,
            roles,
            jti
        },
        process.env.JWT_SECRET,
        { expiresIn: VIGENCIA_TOKEN_SEGUNDOS }
    );

    const expiraEn = new Date(Date.now() + VIGENCIA_TOKEN_SEGUNDOS * 1000);

    return {
        token,
        jti,
        tipo_token: TIPO_TOKEN,
        expiracion: expiraEn.toISOString(),
        expira_en: expiraEn
    };
};

/**
 * Anota un `jti` en la lista de revocados hasta su expiración natural.
 *
 * Idempotente: cerrar sesión dos veces con el mismo token no es un error.
 */
const revocarToken = async (jti, expiraEn) => {
    await TokenRevocado.upsert({ jti, expira_en: expiraEn });
};

/**
 * ¿Está revocado este `jti`?
 *
 * El filtro por `expira_en > NOW()` es lo que permite prescindir del barrido
 * programado: una fila vencida sigue en la tabla pero deja de tener efecto,
 * porque el token que representa ya no habría pasado la verificación de firma.
 */
const estaRevocado = async (jti) => {
    if (!jti) {
        // Un token sin `jti` es de la forma anterior a este paso. No se puede
        // revocar, así que se rechaza en el middleware antes de llegar aquí.
        return false;
    }

    const revocado = await TokenRevocado.findOne({
        where: {
            jti,
            expira_en: { [Op.gt]: new Date() }
        }
    });

    return revocado !== null;
};

/** Convierte el `exp` del token (segundos desde epoch) en una fecha. */
const fechaDeExpiracion = (claims) =>
    claims && claims.exp ? new Date(claims.exp * 1000) : new Date();

module.exports = {
    emitirToken,
    estaRevocado,
    fechaDeExpiracion,
    revocarToken,
    rolPrincipal
};
