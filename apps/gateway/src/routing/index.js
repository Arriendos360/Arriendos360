/**
 * Costura de enrutamiento del gateway.
 *
 * Un solo middleware decide, peticion por peticion, si el prefijo se atiende con
 * el codigo local del monolito o se reenvia por HTTP al microservicio extraido.
 *
 * `/api/auth`, `/api/usuarios` e `/api/inmuebles` estan cableados a sus
 * servicios; el resto sigue resolviendo en local, en el codigo del monolito.
 *
 * Orden de montaje (importa): va DESPUES de `cors()`, del control de acceso y de
 * los guardias, y ANTES de `express.json()`. Que el RBAC vaya primero no es un
 * detalle: una peticion denegada no debe llegar a la red interna. Los guardias
 * van entre medias porque deciden si la peticion llega a salir. Ver el
 * comentario de `proxy.js` sobre streaming del cuerpo.
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

        // Ruta fuera de la tabla (`/`, `/uploads/...`): la atiende el monolito.
        if (!entrada) {
            return next();
        }

        const destino = urlDestino(entrada, entorno);

        // Modo local: el prefijo todavia no se ha extraido.
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
