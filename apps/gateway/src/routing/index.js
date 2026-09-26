/**
 * Costura de enrutamiento: decide por petición si el prefijo se reenvía a su
 * servicio o se atiende aquí (`/api/dashboard`). Se monta después de `cors()`,
 * del control de acceso y de los guardias, y antes de `express.json()`.
 */

const { reenviar } = require('./proxy');
const {
    MENSAJE_CON_CONTRATO,
    crearGuardiaDeBorrado
} = require('./guardias');
const {
    AUTENTICADO,
    MATRIZ,
    PUBLICO,
    describirMatriz,
    esRutaDeApi,
    lineasMatriz,
    resolverPolitica
} = require('./matriz');
const {
    CODIGO_CAMBIO_PENDIENTE,
    MENSAJE_CAMBIO_PENDIENTE,
    MENSAJE_NO_DECLARADA,
    crearControlDeAcceso
} = require('./rbac');
const {
    MODO_LOCAL,
    MODO_REMOTO,
    TABLA_RUTAS,
    describirEnrutamiento,
    lineasEnrutamiento,
    modoDe,
    resolverPrefijo,
    urlDestino
} = require('./tabla');

/**
 * Construye el middleware de enrutamiento.
 *
 * @param {{ entorno?: NodeJS.ProcessEnv, timeoutMs?: number }} [opciones]
 *   `entorno` permite inyectar variables en las pruebas sin tocar `process.env`.
 */
const crearEnrutadorGateway = (opciones = {}) => {
    const entorno = opciones.entorno || process.env;

    return function enrutadorGateway(req, res, next) {
        const entrada = resolverPrefijo(req.path);

        // Ruta fuera de la tabla (`/`): la atiende Express en este proceso.
        if (!entrada) {
            return next();
        }

        const destino = urlDestino(entrada, entorno);

        // Modo local: el prefijo no tiene servicio propio (`/api/dashboard`).
        if (destino === null) {
            return next();
        }

        return reenviar(req, res, destino, entrada.servicio, opciones);
    };
};

module.exports = {
    AUTENTICADO,
    CODIGO_CAMBIO_PENDIENTE,
    MENSAJE_CAMBIO_PENDIENTE,
    MATRIZ,
    MENSAJE_CON_CONTRATO,
    MENSAJE_NO_DECLARADA,
    MODO_LOCAL,
    MODO_REMOTO,
    PUBLICO,
    TABLA_RUTAS,
    crearControlDeAcceso,
    crearEnrutadorGateway,
    crearGuardiaDeBorrado,
    describirMatriz,
    esRutaDeApi,
    lineasMatriz,
    resolverPolitica,
    describirEnrutamiento,
    lineasEnrutamiento,
    modoDe,
    resolverPrefijo,
    urlDestino
};
