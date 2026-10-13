/**
 * Composición de `Inmueble` e `Inquilino` en los contratos que salen por
 * `/api/contratos`. Una petición por servicio para toda la lista. Si un servicio
 * no responde, la propiedad queda en `null`: esto decora, no autoriza.
 */

import {
  ajusteDeCanon,
  cabeceraDeServicio,
  causalesDisponibles,
  enteroDeEntorno,
  hoyEnZonaNegocio,
  preavisoDe,
  textoDeEntorno,
} from 'arriendos360-shared';
import type { ContratoAjustable, ContratoPreavisable, Preaviso } from 'arriendos360-shared';
import {
  ANIOS_PLENA_VOLUNTAD,
  CAUSALES_PREAVISO_ARRENDADOR,
  DIAS_RECORDATORIO_PREAVISO,
  IPC_ANUAL,
  MESES_PREAVISO_TERMINACION,
} from 'arriendos360-contracts';
import type { CausalPreaviso, PartePreaviso } from 'arriendos360-contracts';

import type { InmuebleAjeno } from '../clientes/inmuebles';
import type { UsuarioAjeno } from '../clientes/identidad';
import { urlBase as urlIdentidad } from '../clientes/identidad';
import { urlBase as urlInmuebles } from '../clientes/inmuebles';
import type { Contrato } from '../models/Contrato';
import { ESTADO_CONTRATO_ACTIVO } from '../models/constantes';

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

/**
 * Añade `ajuste_canon` a un contrato ya compuesto, sólo si está activo y `sub` es el dueño
 * de su inmueble: el inquilino no ve un aumento antes de que el propietario lo decida.
 */
export const conAjusteCanon = (
  contrato: Record<string, unknown>,
  sub: string,
): Record<string, unknown> => {
  const inmueble = contrato['Inmueble'] as InmuebleAjeno | null;

  if (contrato['estado'] !== ESTADO_CONTRATO_ACTIVO || inmueble?.id_propietario !== sub) {
    return contrato;
  }

  return {
    ...contrato,
    ajuste_canon: ajusteDeCanon(contrato as unknown as ContratoAjustable, hoyEnZonaNegocio(), IPC_ANUAL),
  };
};

/** El preaviso de un contrato visto desde hoy, con los plazos del catálogo. */
export const preavisoHoy = (contrato: ContratoPreavisable): Preaviso | null =>
  preavisoDe(contrato, hoyEnZonaNegocio(), {
    meses: MESES_PREAVISO_TERMINACION,
    diasRecordatorio: DIAS_RECORDATORIO_PREAVISO,
  });

/** Las causales que el arrendador puede invocar para ese vencimiento. */
export const causalesDelArrendador = (inicio: unknown, vencimiento: string): CausalPreaviso[] =>
  causalesDisponibles(
    Object.keys(CAUSALES_PREAVISO_ARRENDADOR) as CausalPreaviso[],
    inicio,
    vencimiento,
    ANIOS_PLENA_VOLUNTAD,
  );

/** Quién envió el preaviso, derivado de su `sub`. */
export const parteQueAvisa = (contrato: { preaviso_enviado_por?: unknown; id_inquilino?: unknown }): PartePreaviso =>
  contrato.preaviso_enviado_por === contrato.id_inquilino ? 'INQUILINO' : 'PROPIETARIO';

/**
 * Añade `preaviso` a un contrato activo ya compuesto, para las dos partes: la ley obliga a las
 * dos. Sólo el dueño del inmueble recibe `causales_disponibles`.
 */
export const conPreaviso = (contrato: Record<string, unknown>, sub: string): Record<string, unknown> => {
  const preaviso = contrato['estado'] === ESTADO_CONTRATO_ACTIVO ? preavisoHoy(contrato as unknown as ContratoPreavisable) : null;

  if (preaviso === null) {
    return contrato;
  }

  const enviado = contrato['preaviso_enviado_en']
    ? { enviado_en: contrato['preaviso_enviado_en'], parte: parteQueAvisa(contrato), causal: contrato['preaviso_causal'] }
    : null;
  const inmueble = contrato['Inmueble'] as InmuebleAjeno | null;

  return {
    ...contrato,
    preaviso: {
      ...preaviso,
      enviado,
      ...(inmueble?.id_propietario === sub && {
        causales_disponibles: causalesDelArrendador(contrato['inicio'], preaviso.vencimiento),
      }),
    },
  };
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
