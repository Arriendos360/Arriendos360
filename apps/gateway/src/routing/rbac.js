/**
 * Punto de aplicación de políticas (PEP) del gateway.
 *
 * Un único middleware que, antes de que la petición toque nada, resuelve tres
 * preguntas en este orden:
 *
 *   1. ¿Está declarada esta combinación de método y ruta?  Si no, 403.
 *   2. ¿El token es válido, vigente y no está revocado?     Si no, 401 o 403.
 *   3. ¿El rol del usuario cubre la política?               Si no, 403.
 *
 * Va montado ANTES de la costura de enrutamiento a propósito. El Capítulo 2 lo
 * pide así: «si no cuadra, 403 y la petición no llega a la red interna». Un
 * control que se aplicara después del reenvío no protegería nada, sólo
 * maquillaría la respuesta.
 *
 * También va antes de `express.json()`, como la costura, para no consumir el
 * cuerpo: la carga de anexos viaja como multipart y tiene que llegar intacta al
 * reenvío.
 *
 * La consulta de revocados se inyecta. Por esa costura entra hoy la caché en
 * memoria que el gateway refresca contra ms-identidad (`cacheRevocados.js`), y
 * es lo que permite que las pruebas de la matriz corran sin red ni base.
 *
 * Si no se inyecta nada, se deniega toda petición autenticada: no hay valor por
 * defecto razonable. Suponer «no hay revocados» convertiría un olvido de
 * cableado en una desactivación silenciosa del logout.
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

/**
 * Respuesta para una ruta que no figura en la matriz.
 *
 * Deliberadamente vaga: no distingue entre «no existe» y «no tienes permiso»,
 * para no convertir el 403 en un mapa de la API para quien vaya probando rutas.
 */
const MENSAJE_NO_DECLARADA = 'Acceso denegado.';

/**
 * Denegación por tener el cambio de contraseña pendiente.
 *
 * Lleva `error_code` además del mensaje para que la SPA pueda llevar a la
 * pantalla de cambio en vez de mostrar un error genérico. Hay precedente del
 * patrón en `TENANT_NOT_FOUND`.
 */
const CODIGO_CAMBIO_PENDIENTE = 'CAMBIO_CONTRASENA_REQUERIDO';
const MENSAJE_CAMBIO_PENDIENTE =
    'Debes cambiar tu contraseña temporal antes de usar la aplicación.';

/** Denegación por rol cuando la política admite varios roles. */
const MENSAJE_ROL_NO_AUTORIZADO = 'Acceso restringido. Tu rol no cubre esta operación.';

/**
 * Mensaje de denegación por rol.
 *
 * Cuando la política exige sólo PROPIETARIO se reutiliza el mensaje literal que
 * el proyecto ya devolvía, para no cambiar lo que ve un cliente existente.
 */
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
        // Fuera de `/api` la matriz no opina: la raíz la sirve Express por su
        // cuenta.
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

        // Se cuelgan los claims para que los routers y controladores no tengan
        // que volver a verificar el token en la misma petición.
        req.usuario = resultado.claims;

        // Condición transversal: quien entró con una contraseña que no eligió
        // no puede hacer nada más que cambiarla. Va aquí y no en la matriz
        // porque no depende del rol ni del recurso. Ver docs/adr/0007.
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
