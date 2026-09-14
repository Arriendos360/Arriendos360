/**
 * La copia en memoria de este servicio, y la decision de que hacer sin ella.
 *
 * La mecanica esta en `packages/shared`; lo que vive aqui es de donde salen los
 * datos y como se comporta el servicio cuando no hay fuente configurada.
 *
 * SIN `MS_IDENTIDAD_URL` NO SE COMPRUEBA LA REVOCACION: un token de una sesion
 * cerrada entraria. Por eso `server.ts` la exige y el servicio no arranca sin ella.
 * Antes arrancaba con un aviso, con el argumento de poder levantarlo en un portatil
 * sin el resto del stack; no se sostenia, porque la variable solo tiene que tener
 * valor —si ms-identidad no responde, la cache conserva la ultima copia y lo registra—. */

import { crearCacheInvalidacion, enteroDeEntorno } from 'arriendos360-shared';
import type { CacheInvalidacion } from 'arriendos360-shared';

import { invalidacionesVigentes } from '../clientes/identidad';

const intervaloMs = enteroDeEntorno('REVOCADOS_INTERVALO_MS', 15000);

export const cache: CacheInvalidacion = crearCacheInvalidacion({
  obtener: invalidacionesVigentes,
  intervaloMs,
  registrar: (mensaje) => console.error(`⚠️  ms-contratos: ${mensaje}`),
});
