/**
 * Cliente HTTP minimo para llamadas entre servicios.
 *
 * Deliberadamente pequeno: usa el `fetch` global de Node 18+ y no agrega
 * dependencias, porque cada una pesa en la imagen Docker y en los limites de
 * memoria de Container Apps.
 *
 * Es para trafico servicio-a-servicio (por ejemplo, el gateway preguntandole a
 * MS-Contratos por un contrato). El reenvio transparente de la peticion del
 * usuario final NO usa esto: vive en `apps/gateway/src/routing/proxy.js` y
 * necesita hacer streaming del cuerpo para soportar `multipart/form-data`.
 */

import { ESTADO_PUERTA_ENLACE, ErrorHttp, esErrorRespuesta } from './errores';

/** Metodos que el proyecto usa. */
export type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OpcionesPeticion {
  metodo?: MetodoHttp;
  /** Cabeceras adicionales. Se combinan con las del cliente; estas ganan. */
  cabeceras?: Record<string, string>;
  /** Se serializa como JSON. Omitelo para peticiones sin cuerpo. */
  cuerpo?: unknown;
  /** Corta la espera. Por defecto {@link TIMEOUT_POR_DEFECTO_MS}. */
  timeoutMs?: number;
}

export interface RespuestaServicio<T> {
  estado: number;
  /** `true` si el estado esta en el rango 2xx. */
  ok: boolean;
  /** Cuerpo deserializado, o `null` si la respuesta venia vacia o no era JSON. */
  datos: T | null;
}

/** Cinco segundos: suficiente para un salto dentro del mismo entorno. */
export const TIMEOUT_POR_DEFECTO_MS = 5000;

export interface OpcionesCliente {
  /** Cabeceras enviadas en toda peticion, por ejemplo `Authorization`. */
  cabeceras?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Une la URL base con la ruta evitando barras dobles o ausentes.
 */
function unirUrl(base: string, ruta: string): string {
  const baseLimpia = base.replace(/\/+$/, '');
  const rutaLimpia = ruta.startsWith('/') ? ruta : `/${ruta}`;
  return `${baseLimpia}${rutaLimpia}`;
}

/**
 * Lee el cuerpo como JSON, tolerando respuestas vacias o no-JSON.
 *
 * Un `204 No Content` o un texto plano de un balanceador no deben romper al
 * llamante.
 */
async function leerJson<T>(respuesta: Response): Promise<T | null> {
  const texto = await respuesta.text();
  if (texto.length === 0) {
    return null;
  }
  try {
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

export interface ClienteHttp {
  pedir<T>(ruta: string, opciones?: OpcionesPeticion): Promise<RespuestaServicio<T>>;
}

/**
 * Crea un cliente apuntando a la URL base de un servicio.
 *
 * Los fallos de red (servicio caido, DNS, timeout) se traducen a
 * {@link ErrorHttp} con estado `502`: desde el punto de vista de quien llama,
 * el upstream no respondio. Las respuestas HTTP de error (4xx, 5xx) NO lanzan;
 * llegan en `estado` para que el llamante decida.
 *
 * @example
 * const contratos = crearClienteHttp(process.env.MS_CONTRATOS_URL, {
 *   cabeceras: { Authorization: req.headers.authorization },
 * });
 * const { estado, datos } = await contratos.pedir('/api/contratos/' + id);
 */
export function crearClienteHttp(
  urlBase: string,
  opcionesCliente: OpcionesCliente = {},
): ClienteHttp {
  return {
    async pedir<T>(
      ruta: string,
      opciones: OpcionesPeticion = {},
    ): Promise<RespuestaServicio<T>> {
      const metodo = opciones.metodo ?? 'GET';
      const timeoutMs =
        opciones.timeoutMs ?? opcionesCliente.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS;

      const cabeceras: Record<string, string> = {
        ...opcionesCliente.cabeceras,
        ...opciones.cabeceras,
      };

      let cuerpo: string | undefined;
      if (opciones.cuerpo !== undefined) {
        cuerpo = JSON.stringify(opciones.cuerpo);
        cabeceras['Content-Type'] ??= 'application/json';
      }

      const url = unirUrl(urlBase, ruta);

      let respuesta: Response;
      try {
        respuesta = await fetch(url, {
          method: metodo,
          headers: cabeceras,
          body: cuerpo,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (causa) {
        const detalle = causa instanceof Error ? causa.message : String(causa);
        throw new ErrorHttp(
          ESTADO_PUERTA_ENLACE,
          `No se pudo contactar el servicio en ${url}: ${detalle}`,
        );
      }

      const datos = await leerJson<T>(respuesta);

      return {
        estado: respuesta.status,
        ok: respuesta.ok,
        datos,
      };
    },
  };
}

/**
 * Extrae el `mensaje` de una respuesta de error de otro servicio.
 *
 * Devuelve el mensaje de respaldo si el cuerpo no sigue la convencion
 * `{ mensaje }`.
 */
export function mensajeDeError(datos: unknown, respaldo: string): string {
  return esErrorRespuesta(datos) ? datos.mensaje : respaldo;
}
