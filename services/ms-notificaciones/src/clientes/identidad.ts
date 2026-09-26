/**
 * Cliente de MS-Notificaciones hacia MS-Identidad: resuelve el correo de cada
 * destinatario a partir de su `id_usuario`, en lote. Si no puede preguntar, lanza
 * para que el evento se reintente.
 */

import { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_IDENTIDAD_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-identidad';

/** Lo que este servicio mira de un usuario: a donde escribirle y como llamarle. */
export interface UsuarioAjeno {
  id: string;
  nombres?: string;
  apellidos?: string;
  email?: string;
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

/** Datos de varios usuarios, indexados por id. Lanza si no se puede preguntar. */
export const usuariosPorIds = async (
  ids: Array<string | null | undefined>,
  opciones: { urlBase?: string | null } = {},
): Promise<Map<string, UsuarioAjeno>> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];

  if (unicos.length === 0) {
    return new Map();
  }

  if (base === null) {
    throw new Error(
      'MS_IDENTIDAD_URL sin definir: no se puede resolver el destinatario de la notificación',
    );
  }

  const url = `${base}/interno/usuarios?ids=${encodeURIComponent(unicos.join(','))}`;

  const respuesta = await fetch(url, {
    headers: cabeceraDeServicio({
      emisor: textoDeEntorno('SERVICIO_NOMBRE', 'ms-notificaciones'),
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (!respuesta.ok) {
    throw new Error(`ms-identidad respondió ${respuesta.status} a ${url}`);
  }

  const datos = (await respuesta.json()) as { usuarios?: UsuarioAjeno[] };

  return new Map((datos.usuarios ?? []).map((usuario) => [usuario.id, usuario]));
};

/** A quien se avisa: el usuario, con su correo ya resuelto. */
export interface Destinatario {
  id_usuario: string;
  email: string;
  nombres: string;
}

/**
 * Los destinatarios de una lista de identificadores. Los usuarios que no existen
 * o no tienen correo se omiten.
 */
export const destinatariosDe = async (
  ids: Array<string | null | undefined>,
): Promise<Map<string, Destinatario>> => {
  const usuarios = await usuariosPorIds(ids);
  const resueltos = new Map<string, Destinatario>();

  for (const [id, usuario] of usuarios) {
    const email = usuario.email?.trim();
    if (!email) {
      continue;
    }

    resueltos.set(id, {
      id_usuario: id,
      email,
      nombres: usuario.nombres?.trim() ?? '',
    });
  }

  return resueltos;
};
