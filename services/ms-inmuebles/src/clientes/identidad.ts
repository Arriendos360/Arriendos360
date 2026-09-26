/** Cliente hacia ms-identidad: trae lo que invalida tokens, para la caché. */

import { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } from 'arriendos360-shared';
import type { Invalidaciones } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_IDENTIDAD_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-identidad';

/** URL base del servicio, o null si no esta configurado. */
export const urlBase = (entorno: NodeJS.ProcessEnv = process.env): string | null => {
  const valor = entorno['MS_IDENTIDAD_URL'];
  if (typeof valor !== 'string') {
    return null;
  }

  const limpio = valor.trim();
  return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/**
 * Trae los `jti` revocados y las sesiones caídas. Propaga el fallo, para
 * distinguir «no hay nada» de «no pude preguntar».
 */
export const invalidacionesVigentes = async (
  opciones: { urlBase?: string | null } = {},
): Promise<Invalidaciones> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    return { revocados: [], sesiones: [] };
  }

  const respuesta = await fetch(`${base}/interno/revocados`, {
    headers: cabeceraDeServicio({
      emisor: textoDeEntorno('SERVICIO_NOMBRE', 'ms-inmuebles'),
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (!respuesta.ok) {
    throw new Error(`ms-identidad respondió ${respuesta.status} a /interno/revocados`);
  }

  return (await respuesta.json()) as Invalidaciones;
};
