/**
 * Cliente de MS-Financiero hacia MS-Identidad:
 * - `invalidacionesVigentes`: lo que invalida tokens. Propaga el fallo.
 * - `usuariosPorIds`: datos de usuarios en lote, para los PDF. Mapa vacío si falla.
 */

import { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } from 'arriendos360-shared';
import type { Invalidaciones } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_IDENTIDAD_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-identidad';

/** Lo que este servicio mira de un usuario. */
export interface UsuarioAjeno {
  id: string;
  nombres?: string;
  apellidos?: string;
  email?: string;
  documento?: string;
  telefono?: string;
  roles?: string[];
}

/** URL base del servicio, o null si no esta configurado. */
export const urlBase = (entorno: NodeJS.ProcessEnv = process.env): string | null => {
  const valor = entorno['MS_IDENTIDAD_URL'];
  if (typeof valor !== 'string') {
    return null;
  }

  const limpio = valor.trim();
  return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/** GET a un endpoint `/interno`, firmado en cada llamada y con tiempo límite. */
const pedirJson = async (url: string): Promise<unknown> => {
  const respuesta = await fetch(url, {
    headers: cabeceraDeServicio({
      emisor: textoDeEntorno('SERVICIO_NOMBRE', 'ms-financiero'),
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (!respuesta.ok) {
    throw new Error(`ms-identidad respondió ${respuesta.status} a ${url}`);
  }

  return respuesta.json();
};

/** Trae los `jti` revocados y las sesiones caídas, para la caché. Propaga el fallo. */
export const invalidacionesVigentes = async (
  opciones: { urlBase?: string | null } = {},
): Promise<Invalidaciones> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    return { revocados: [], sesiones: [] };
  }

  return (await pedirJson(`${base}/interno/revocados`)) as Invalidaciones;
};

/** Datos de varios usuarios, indexados por id. Mapa vacío si falla. */
export const usuariosPorIds = async (
  ids: Array<string | null | undefined>,
  opciones: { urlBase?: string | null } = {},
): Promise<Map<string, UsuarioAjeno>> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];

  if (base === null || unicos.length === 0) {
    return new Map();
  }

  try {
    const datos = (await pedirJson(
      `${base}/interno/usuarios?ids=${encodeURIComponent(unicos.join(','))}`,
    )) as { usuarios?: UsuarioAjeno[] };

    return new Map((datos.usuarios ?? []).map((usuario) => [usuario.id, usuario]));
  } catch (error) {
    console.error(
      '⚠️  ms-financiero: no se pudieron obtener usuarios de ms-identidad:',
      (error as Error).message,
    );
    return new Map();
  }
};
