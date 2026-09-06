/**
 * Costura de enrutamiento del gateway.
 *
 * Un solo middleware decide, peticion por peticion, si el prefijo se atiende con
 * el codigo local del monolito o se reenvia por HTTP al microservicio extraido.
 *
 * Hoy las cuatro variables `MS_*_URL` estan vacias, asi que siempre llama a
 * `next()` y la peticion sigue el mismo camino de siempre: parsers de cuerpo y
 * routers de Express. Esta costura no cambia nada observable todavia; existe
 * para que el paso 3 solo tenga que poner una URL en el entorno.
 *
 * Orden de montaje (importa): va DESPUES de `cors()` y ANTES de
 * `express.json()`. Ver el comentario de `proxy.js` sobre streaming del cuerpo.
 */

const { reenviar } = require('./proxy');
const {
    MODO_LOCAL,
    MODO_REMOTO,
    TABLA_RUTAS,
    describirEnrutamiento,
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
    MODO_LOCAL,
    MODO_REMOTO,
    TABLA_RUTAS,
    crearEnrutadorGateway,
    describirEnrutamiento,
    modoDe,
    resolverPrefijo,
    urlDestino
};
