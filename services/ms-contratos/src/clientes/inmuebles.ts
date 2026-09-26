/**
 * Cliente de MS-Contratos hacia MS-Inmuebles, para comprobar pertenencia. Los
 * fallos se propagan siempre: nunca se degradan a 403 ni a una lista vacía.
 */

import { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_INMUEBLES_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-inmuebles';

/** Lo que este servicio necesita saber de un inmueble: de quien es. */
export interface InmuebleAjeno {
  id_inmueble: string;
  id_propietario: string;
  [clave: string]: unknown;
}

/** URL base del servicio, o null si todavia no esta configurado. */
export const urlBase = (entorno: NodeJS.ProcessEnv = process.env): string | null => {
  const valor = entorno['MS_INMUEBLES_URL'];
  if (typeof valor !== 'string') {
    return null;
  }

  const limpio = valor.trim();
  return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/** GET a `/interno` con credencial de servicio. Todo lo de aqui son consultas. */
const pedirJson = async (url: string): Promise<{ inmuebles?: InmuebleAjeno[] }> => {
  const respuesta = await fetch(url, {
    headers: cabeceraDeServicio({
      emisor: textoDeEntorno('SERVICIO_NOMBRE', 'ms-contratos'),
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (!respuesta.ok) {
    throw new Error(`ms-inmuebles respondió ${respuesta.status} a ${url}`);
  }

  return (await respuesta.json()) as { inmuebles?: InmuebleAjeno[] };
};

/**
 * Los identificadores de los inmuebles de un propietario.
 *
 * @throws si el servicio no responde.
 */
export const idsDePropietario = async (
  sub: string,
  opciones: { urlBase?: string | null } = {},
): Promise<string[]> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    return [];
  }

  const datos = await pedirJson(
    `${base}/interno/inmuebles?propietario=${encodeURIComponent(sub)}`,
  );

  return (datos.inmuebles ?? []).map((inmueble) => inmueble.id_inmueble);
};

/**
 * Un inmueble, sólo si su `id_propietario` es `sub`; si no, `null`.
 *
 * @throws si el servicio no responde.
 */
export const propioDe = async (
  idInmueble: string,
  sub: string,
  opciones: { urlBase?: string | null } = {},
): Promise<InmuebleAjeno | null> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null || !idInmueble) {
    return null;
  }

  const datos = await pedirJson(
    `${base}/interno/inmuebles?ids=${encodeURIComponent(idInmueble)}`,
  );
  const inmueble = (datos.inmuebles ?? [])[0];

  return inmueble && inmueble.id_propietario === sub ? inmueble : null;
};
