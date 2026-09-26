/**
 * Composición de `Inmueble` e `Inquilino` en los contratos que salen por
 * `/api/contratos`. Una petición por servicio para toda la lista. Si un servicio
 * no responde, la propiedad queda en `null`: esto decora, no autoriza.
 */

import { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } from 'arriendos360-shared';

import type { InmuebleAjeno } from '../clientes/inmuebles';
import type { UsuarioAjeno } from '../clientes/identidad';
import { urlBase as urlIdentidad } from '../clientes/identidad';
import { urlBase as urlInmuebles } from '../clientes/inmuebles';
import type { Contrato } from '../models/Contrato';

const TIEMPO_LIMITE_MS = enteroDeEntorno('COMPOSICION_TIMEOUT_MS', 3000);

/** Da al usuario la forma de `Inquilino` que lee el frontend. */
const comoUsuario = (usuario: UsuarioAjeno | undefined): Record<string, unknown> | null =>
  usuario
    ? {
        id_usuario: usuario.id,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        documento: usuario.documento,
        telefono: usuario.telefono,
        email: usuario.email,
      }
    : null;

/** GET a un `/interno` de otro servicio; `null` si falla. */
const pedirONada = async (url: string, destinatario: string): Promise<unknown> => {
  try {
    const respuesta = await fetch(url, {
      headers: cabeceraDeServicio({
        emisor: textoDeEntorno('SERVICIO_NOMBRE', 'ms-contratos'),
        destinatario,
        secreto: process.env['SERVICIO_JWT_SECRET'],
      }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });

    if (!respuesta.ok) {
      throw new Error(`${destinatario} respondió ${respuesta.status}`);
    }

    return await respuesta.json();
  } catch (error) {
    console.error(
      `⚠️  ms-contratos: no se pudo componer desde ${destinatario}:`,
      (error as Error).message,
    );
    return null;
  }
};

/** Inmuebles por id, en lote. Mapa vacio si no se pudo preguntar. */
const inmueblesPorIds = async (ids: string[]): Promise<Map<string, InmuebleAjeno>> => {
  const base = urlInmuebles();
  const unicos = [...new Set(ids.filter(Boolean))];

  if (base === null || unicos.length === 0) {
    return new Map();
  }

  const datos = (await pedirONada(
    `${base}/interno/inmuebles?ids=${encodeURIComponent(unicos.join(','))}`,
    'ms-inmuebles',
  )) as { inmuebles?: InmuebleAjeno[] } | null;

  return new Map((datos?.inmuebles ?? []).map((i) => [i.id_inmueble, i]));
};

/** Usuarios por id, en lote. Mapa vacio si no se pudo preguntar. */
const usuariosPorIds = async (ids: string[]): Promise<Map<string, UsuarioAjeno>> => {
  const base = urlIdentidad();
  const unicos = [...new Set(ids.filter(Boolean))];

  if (base === null || unicos.length === 0) {
    return new Map();
  }

  const datos = (await pedirONada(
    `${base}/interno/usuarios?ids=${encodeURIComponent(unicos.join(','))}`,
    'ms-identidad',
  )) as { usuarios?: UsuarioAjeno[] } | null;

  return new Map((datos?.usuarios ?? []).map((u) => [u.id, u]));
};

/** Adjunta `Inmueble` e `Inquilino` a una lista de contratos, con dos peticiones en paralelo. */
export const adjuntarPartes = async (
  contratos: Contrato[],
): Promise<Array<Record<string, unknown>>> => {
  const lista = contratos.map((c) => c.toJSON() as Record<string, unknown>);

  const [inmuebles, usuarios] = await Promise.all([
    inmueblesPorIds(lista.map((c) => c['id_inmueble'] as string)),
    usuariosPorIds(lista.map((c) => c['id_inquilino'] as string)),
  ]);

  return lista.map((contrato) => ({
    ...contrato,
    Inmueble: inmuebles.get(contrato['id_inmueble'] as string) ?? null,
    Inquilino: comoUsuario(usuarios.get(contrato['id_inquilino'] as string)),
  }));
};

/** Adjunta `Inmueble` e `Inquilino` a un solo contrato. */
export const adjuntarPartesA = async (
  contrato: Contrato,
): Promise<Record<string, unknown>> => {
  const [conPartes] = await adjuntarPartes([contrato]);
  return conPartes as Record<string, unknown>;
};

/**
 * Adjunta sólo el `Inmueble` a una lista de contratos, con una petición. Lo usa
 * `/interno/contratos?incluir=inmueble`.
 */
export const adjuntarInmuebles = async (
  contratos: Contrato[],
): Promise<Array<Record<string, unknown>>> => {
  const lista = contratos.map((contrato) => contrato.toJSON() as Record<string, unknown>);

  const inmuebles = await inmueblesPorIds(lista.map((c) => c['id_inmueble'] as string));

  return lista.map((contrato) => ({
    ...contrato,
    Inmueble: inmuebles.get(contrato['id_inmueble'] as string) ?? null,
  }));
};
