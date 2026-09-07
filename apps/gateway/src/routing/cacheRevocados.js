/**
 * Caché en memoria de lo que invalida tokens, para el gateway.
 *
 * La mecánica NO vive aquí: está en `packages/shared`, y este archivo es sólo el
 * cableado —de dónde salen los datos y cómo se registran los fallos.
 *
 * ANTES ERAN DOS IMPLEMENTACIONES. Esta lógica nació aquí, en JavaScript y sólo
 * para el gateway. Al extraer ms-inmuebles hizo falta lo mismo en un servicio
 * TypeScript: cualquier servicio que revalide el token de verdad (regla dura 7)
 * tiene que comprobar la revocación, y sólo ms-identidad tiene la tabla.
 * Copiarla habría dejado dos versiones de una regla de seguridad, que es como se
 * consigue que un logout deje de surtir efecto en un servicio y nadie se entere.
 *
 * Lo que el Capítulo 2 pide sigue igual: «para que la consulta no pese en cada
 * petición, el gateway mantiene una copia en memoria de los `jti` vigentes y la
 * refresca periódicamente». Ver `docs/adr/0008` para la ventana que implica, y
 * `packages/shared/src/revocacion.ts` para las dos formas de invalidar un token
 * y por qué un fallo de red conserva la última copia buena.
 */

const { INTERVALO_POR_DEFECTO_MS, crearCacheInvalidacion } = require('arriendos360-shared');

const { revocadosVigentes } = require('../clientes/identidad');

/** Cada cuánto se vuelve a preguntar. Ver ADR 0008. */
const INTERVALO_MS = Number(process.env.REVOCADOS_INTERVALO_MS || INTERVALO_POR_DEFECTO_MS);

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
