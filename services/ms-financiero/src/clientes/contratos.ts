/**
 * Cliente de MS-Financiero hacia MS-Contratos.
 *
 * - Lo que autoriza (`contratosDondeEsParte`, `contratosDePropietario`,
 *   `contratosConEstado`, `propioDe`, `parteDe`) propaga el fallo.
 * - Lo que decora (`porIds`, `porId`) devuelve vacío ante un fallo.
 *
 * Con `conInmueble`, cada contrato viene con su `Inmueble` en la misma petición.
 */

import { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_CONTRATOS_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-contratos';

/** Lo que este servicio mira de un inmueble ajeno. */
export interface InmuebleAjeno {
  id_inmueble: string;
  id_propietario: string;
  direccion?: string;
  barrio?: string;
  alias?: string;
  ciudad?: string;
  tipo?: string;
  [clave: string]: unknown;
}

/** Lo que este servicio mira de un contrato ajeno. */
export interface ContratoAjeno {
  id_contrato: string;
  id_inmueble: string;
  id_inquilino: string;
  canon: number | string;
  fecha_inicio_corte: string;
  estado: string;
  /** Presente solo si se pidio con `incluir=inmueble`. */
  Inmueble?: InmuebleAjeno | null;
  [clave: string]: unknown;
}

/** URL base del servicio, o null si todavia no esta configurado. */
export const urlBase = (entorno: NodeJS.ProcessEnv = process.env): string | null => {
  const valor = entorno['MS_CONTRATOS_URL'];
  if (typeof valor !== 'string') {
    return null;
  }

  const limpio = valor.trim();
  return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/** GET a `/interno` con credencial de servicio. Todo lo de aqui son consultas. */
const pedirJson = async (url: string): Promise<{ contratos?: ContratoAjeno[]; contrato?: ContratoAjeno } | null> => {
  const respuesta = await fetch(url, {
    headers: cabeceraDeServicio({
      emisor: textoDeEntorno('SERVICIO_NOMBRE', 'ms-financiero'),
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (respuesta.status === 404) {
    return null;
  }

  if (!respuesta.ok) {
    throw new Error(`ms-contratos respondió ${respuesta.status} a ${url}`);
  }

  return (await respuesta.json()) as { contratos?: ContratoAjeno[]; contrato?: ContratoAjeno };
};

export interface OpcionesConsulta {
  urlBase?: string | null;
  /** Pide que cada contrato venga con su `Inmueble` dentro. */
  conInmueble?: boolean;
}

/** Consulta con filtros y devuelve la lista. PROPAGA el fallo. */
const consultar = async (query: string, opciones: OpcionesConsulta = {}): Promise<ContratoAjeno[]> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    return [];
  }

  const con = opciones.conInmueble ? '&incluir=inmueble' : '';
  const datos = await pedirJson(`${base}/interno/contratos?${query}${con}`);
  return datos?.contratos ?? [];
};

/**
 * Los contratos donde el usuario es dueño del inmueble o inquilino.
 *
 * @throws si ms-contratos no responde.
 */
export const contratosDondeEsParte = (
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno[]> => consultar(`parte=${encodeURIComponent(sub)}`, opciones);

/** Los identificadores de `contratosDondeEsParte`. */
export const idsDondeEsParte = async (
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<string[]> =>
  (await contratosDondeEsParte(sub, opciones)).map((contrato) => contrato.id_contrato);

/**
 * Los contratos sobre los inmuebles de un propietario.
 *
 * @throws si ms-contratos no responde.
 */
export const contratosDePropietario = (
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno[]> => consultar(`propietario=${encodeURIComponent(sub)}`, opciones);

/**
 * Los contratos con un estado dado, de todo el sistema, en una petición. Es el
 * barrido del motor.
 *
 * @throws si ms-contratos no responde.
 */
export const contratosConEstado = (
  estado: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno[]> => consultar(`estado=${encodeURIComponent(estado)}`, opciones);

/** Datos de varios contratos, indexados por id, en lote. Mapa vacío si falla. */
export const porIds = async (
  ids: Array<string | null | undefined>,
  opciones: OpcionesConsulta = {},
): Promise<Map<string, ContratoAjeno>> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];

  if (base === null || unicos.length === 0) {
    return new Map();
  }

  try {
    const con = opciones.conInmueble ? '&incluir=inmueble' : '';
    const datos = await pedirJson(
      `${base}/interno/contratos?ids=${encodeURIComponent(unicos.join(','))}${con}`,
    );

    return new Map((datos?.contratos ?? []).map((contrato) => [contrato.id_contrato, contrato]));
  } catch (error) {
    // Se registra pero no se propaga: esto es decorar, no autorizar.
    console.error(
      '⚠️  ms-financiero: no se pudieron obtener contratos de ms-contratos:',
      (error as Error).message,
    );
    return new Map();
  }
};

/** Un contrato, o null. Azucar sobre `porIds`. DEGRADA. */
export const porId = async (
  id: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno | null> => {
  const mapa = await porIds([id], opciones);
  return mapa.get(id) ?? null;
};

/** Un contrato, sólo si es sobre un inmueble de este propietario; si no, `null`. Propaga el fallo. */
export const propioDe = async (
  idContrato: string,
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno | null> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null || !idContrato) {
    return null;
  }

  const datos = await pedirJson(
    `${base}/interno/contratos/${encodeURIComponent(idContrato)}` +
      `?propietario=${encodeURIComponent(sub)}`,
  );

  return datos?.contrato ?? null;
};

/** El contrato si el usuario es parte de él, buscado en `contratosDondeEsParte`. Propaga el fallo. */
export const parteDe = async (
  idContrato: string,
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno | null> => {
  const contratos = await contratosDondeEsParte(sub, opciones);
  return contratos.find((contrato) => contrato.id_contrato === idContrato) ?? null;
};
