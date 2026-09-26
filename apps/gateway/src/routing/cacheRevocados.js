/**
 * Caché en memoria de lo que invalida tokens, para el gateway. Conecta la caché de
 * `packages/shared` con ms-identidad.
 */

const {
    INTERVALO_POR_DEFECTO_MS,
    crearCacheInvalidacion,
    enteroDeEntorno
} = require('arriendos360-shared');

const { revocadosVigentes } = require('../clientes/identidad');

/** Cada cuánto se vuelve a preguntar. */
const INTERVALO_MS = enteroDeEntorno('REVOCADOS_INTERVALO_MS', INTERVALO_POR_DEFECTO_MS);

/**
 * Construye la caché del gateway.
 *
 * @param {{ intervaloMs?: number, obtener?: () => Promise<object> }} [opciones]
 *   `obtener` se inyecta en las pruebas para no depender de la red.
 */
const crearCacheRevocados = (opciones = {}) =>
    crearCacheInvalidacion({
        obtener: opciones.obtener || revocadosVigentes,
        intervaloMs: opciones.intervaloMs || INTERVALO_MS,
        registrar: (mensaje) => console.error(`⚠️  ${mensaje}`)
    });

module.exports = { INTERVALO_POR_DEFECTO_MS: INTERVALO_MS, crearCacheRevocados };
