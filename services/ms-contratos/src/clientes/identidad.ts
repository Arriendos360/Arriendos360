/**
 * Cliente de MS-Contratos hacia MS-Identidad:
 * - `invalidacionesVigentes`: lo que invalida tokens. Propaga el fallo.
 * - `usuarioPorId`: datos de un usuario; `null` si falla.
 * - `reemitirContrasenaTemporal`: propaga el fallo.
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

/** Petición a un endpoint `/interno`, firmada en cada llamada y con tiempo límite. */
const pedirJson = async (
  url: string,
  metodo: 'GET' | 'POST' = 'GET',
  cuerpo: unknown = null,
): Promise<unknown> => {
  const respuesta = await fetch(url, {
    method: metodo,
    headers: {
      ...cabeceraDeServicio({
        emisor: textoDeEntorno('SERVICIO_NOMBRE', 'ms-contratos'),
        destinatario: DESTINATARIO,
        secreto: process.env['SERVICIO_JWT_SECRET'],
      }),
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
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

/** Datos de un usuario, o `null` si no existe o no se pudo preguntar. */
export const usuarioPorId = async (
  id: string,
  opciones: { urlBase?: string | null } = {},
): Promise<UsuarioAjeno | null> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null || !id) {
    return null;
  }

  try {
    const datos = (await pedirJson(
      `${base}/interno/usuarios?ids=${encodeURIComponent(id)}`,
    )) as { usuarios?: UsuarioAjeno[] };

    return (datos.usuarios ?? [])[0] ?? null;
  } catch (error) {
    console.error(
      '⚠️  ms-contratos: no se pudo consultar el usuario en ms-identidad:',
      (error as Error).message,
    );
    return null;
  }
};

export interface ReemisionContrasena {
  contrasena_temporal: string;
  usuario: UsuarioAjeno;
}

/**
 * Pide a ms-identidad que regenere la contraseña temporal de un usuario. La
 * autorización la comprueba quien llama. Propaga el fallo.
 */
export const reemitirContrasenaTemporal = async (
  idUsuario: string,
  solicitadoPor: string,
  opciones: { urlBase?: string | null } = {},
): Promise<ReemisionContrasena> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    throw new Error('MS_IDENTIDAD_URL no está configurada');
  }

  return (await pedirJson(
    `${base}/interno/usuarios/${encodeURIComponent(idUsuario)}/contrasena-temporal`,
    'POST',
    // Quién lo pidió, para la auditoría.
    { solicitado_por: solicitadoPor },
  )) as ReemisionContrasena;
};
