/**
 * Lo unico que este servicio le pide a ms-identidad: que tokens dejaron de valer.
 *
 * No pide datos de usuario. Un inmueble guarda el UUID de su propietario y nada
 * mas; quien necesite su nombre —el gateway, al componer un PDF— se lo pregunta
 * a ms-identidad por su cuenta. Este servicio no compone nada de otro contexto.
 *
 * Se llama una vez cada 15 segundos, no una por peticion: lo que se consulta en
 * el camino critico es la copia en memoria de `packages/shared`. Ver
 * `docs/adr/0008`.
 */

import { cabeceraDeServicio } from 'arriendos360-shared';
import type { Invalidaciones } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = Number(process.env['MS_IDENTIDAD_TIMEOUT_MS'] ?? 3000);

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
 * Trae los `jti` revocados y las sesiones caidas.
 *
 * El fallo SE PROPAGA. Quien llama es el refresco de la cache, y necesita
 * distinguir entre «no hay nada que invalidar» y «no pude preguntar»: confundir
 * las dos cosas dejaria entrar tokens de sesiones ya cerradas sin que nadie se
 * entere. La cache decide que hacer con el fallo — conservar su ultima copia
 * buena — y eso es una decision suya, no de este cliente.
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
      emisor: process.env['SERVICIO_NOMBRE'] ?? 'ms-inmuebles',
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
