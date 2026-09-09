/**
 * La copia en memoria de este servicio, y la decision de que hacer sin ella.
 *
 * La mecanica esta en `packages/shared`; lo que vive aqui es de donde salen los
 * datos y como se comporta el servicio cuando no hay fuente configurada.
 *
 * SIN `MS_IDENTIDAD_URL` NO SE COMPRUEBA LA REVOCACION. El servicio arranca
 * igual y verifica firma y vigencia, pero un token de una sesion cerrada
 * entraria. Es la configuracion de una prueba aislada, no la de un despliegue, y
 * por eso el arranque lo grita en el log en vez de fallar en silencio: fallar
 * duro dejaria el servicio sin poder levantarse en un portatil sin el resto del
 * stack, y ese coste no compensa.
 */

import { crearCacheInvalidacion } from 'arriendos360-shared';
import type { CacheInvalidacion } from 'arriendos360-shared';

import { invalidacionesVigentes, urlBase } from '../clientes/identidad';

/**
 * Cada cuanto se refresca la copia.
 *
 * `|| 15000` y NO `?? 15000`, y la diferencia no es estilo. `??` solo cubre
 * `undefined`, y una variable de entorno DECLARADA Y VACIA —`REVOCADOS_INTERVALO_MS=`
 * en un `.env`, que es justo como queda al copiar el `.env.example`— llega como
 * cadena vacia: `Number('')` es `0`, `??` lo deja pasar, y el resultado es un
 * `setInterval` de cero milisegundos martilleando a ms-identidad en bucle.
 *
 * Con `||` cualquier valor que no sea un numero util —vacio, `0`, `abc`— cae en
 * el defecto, que es lo que se quiere de un intervalo.
 */
const intervaloMs = Number(process.env['REVOCADOS_INTERVALO_MS']) || 15000;

export const cache: CacheInvalidacion = crearCacheInvalidacion({
  obtener: invalidacionesVigentes,
  intervaloMs,
  registrar: (mensaje) => console.error(`⚠️  ms-financiero: ${mensaje}`),
});

/** ¿Hay de donde traer la lista? */
export const hayFuenteDeRevocacion = (): boolean => urlBase() !== null;
