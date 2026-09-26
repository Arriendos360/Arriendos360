/**
 * Control de acceso del gateway, antes de la costura y de `express.json()`:
 *
 *   1. ¿Está declarada esta combinación de método y ruta?  Si no, 403.
 *   2. ¿El token es válido, vigente y no está revocado?     Si no, 401 o 403.
 *   3. ¿El rol del usuario cubre la política?               Si no, 403.
 *
 * Sin `tokenInvalidado` inyectado, deniega toda petición autenticada.
 */

const {
    MENSAJE_ROL_INSUFICIENTE,
    crearError,
    tieneRol,
    verificarTokenConRevocacion
} = require('arriendos360-shared');

const {
    AUTENTICADO,
    PUBLICO,
    esRutaDeApi,
    permitidaConCambioPendiente,
    resolverPolitica
} = require('./matriz');

/** Respuesta para una ruta no declarada. No distingue «no existe» de «no puedes». */
const MENSAJE_NO_DECLARADA = 'Acceso denegado.';

/** Denegación por cambio de contraseña pendiente; `error_code` lo reconoce la SPA. */
const CODIGO_CAMBIO_PENDIENTE = 'CAMBIO_CONTRASENA_REQUERIDO';
const MENSAJE_CAMBIO_PENDIENTE =
    'Debes cambiar tu contraseña temporal antes de usar la aplicación.';

/** Denegación por rol cuando la política admite varios roles. */
const MENSAJE_ROL_NO_AUTORIZADO = 'Acceso restringido. Tu rol no cubre esta operación.';

/** Mensaje de denegación por rol. */
const mensajeDeRol = (acceso) =>
    acceso.length === 1 && acceso[0] === 'PROPIETARIO'
        ? MENSAJE_ROL_INSUFICIENTE
        : MENSAJE_ROL_NO_AUTORIZADO;

/**
 * Construye el middleware de control de acceso.
 *
 * @param {{ tokenInvalidado?: (claims: object) => Promise<boolean>, secreto?: string }} [opciones]
 */
const crearControlDeAcceso = (opciones = {}) => {
    const consultarInvalidacion =
        opciones.tokenInvalidado ||
        (() => {
            throw new Error(
                'crearControlDeAcceso() necesita `tokenInvalidado`: sin él no se puede saber si un token dejó de valer.'
            );
        });

    return async function controlDeAcceso(req, res, next) {
        // Fuera de `/api` la matriz no opina.
        if (!esRutaDeApi(req.path)) {
            return next();
        }

        const politica = resolverPolitica(req.method, req.path);

        // Denegar por defecto.
        if (!politica) {
            return res.status(403).json(crearError(MENSAJE_NO_DECLARADA));
        }

        if (politica.acceso === PUBLICO) {
            return next();
        }

        const secreto = opciones.secreto || process.env.JWT_SECRET;
        const resultado = await verificarTokenConRevocacion(
            { authorization: req.headers['authorization'] },
            secreto,
            consultarInvalidacion
        );

        if (!resultado.valido) {
            return res.status(resultado.estado).json(resultado.error);
        }

        // Claims para los routers y controladores.
        req.usuario = resultado.claims;

        // Con el cambio de contraseña pendiente sólo se permite cambiarla.
        if (
            resultado.claims.debe_cambiar === true &&
            !permitidaConCambioPendiente(req.method, req.path)
        ) {
            return res.status(403).json({
                ...crearError(MENSAJE_CAMBIO_PENDIENTE),
                error_code: CODIGO_CAMBIO_PENDIENTE
            });
        }

        if (politica.acceso === AUTENTICADO) {
            return next();
        }

        if (!tieneRol(resultado.claims, ...politica.acceso)) {
            return res.status(403).json(crearError(mensajeDeRol(politica.acceso)));
        }

        return next();
    };
};

module.exports = {
    CODIGO_CAMBIO_PENDIENTE,
    MENSAJE_CAMBIO_PENDIENTE,
    MENSAJE_NO_DECLARADA,
    MENSAJE_ROL_NO_AUTORIZADO,
    crearControlDeAcceso,
    mensajeDeRol
};
