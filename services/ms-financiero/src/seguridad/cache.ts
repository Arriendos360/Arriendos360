/** Copia en memoria de lo que invalida tokens, alimentada desde ms-identidad. */

import { crearCacheInvalidacion, enteroDeEntorno } from 'arriendos360-shared';
import type { CacheInvalidacion } from 'arriendos360-shared';

import { invalidacionesVigentes } from '../clientes/identidad';

const intervaloMs = enteroDeEntorno('REVOCADOS_INTERVALO_MS', 15000);

export const cache: CacheInvalidacion = crearCacheInvalidacion({
  obtener: invalidacionesVigentes,
  intervaloMs,
  registrar: (mensaje) => console.error(`⚠️  ms-financiero: ${mensaje}`),
});
