/**
 * Autenticación entre servicios para `/interno`: un JWT de vida corta firmado con
 * `SERVICIO_JWT_SECRET` (nunca `JWT_SECRET`) bajo el esquema `Servicio`, que un
 * token de usuario `Bearer` no puede suplantar.
 */

import jwt from 'jsonwebtoken';

import {
  ESTADO_SIN_TOKEN,
  type ErrorRespuesta,
  crearError,
} from './errores';

/** Esquema de la cabecera `Authorization` para llamadas entre servicios. */
export const ESQUEMA_SERVICIO = 'Servicio';

/** Vida del token, en segundos. */
export const VIGENCIA_POR_DEFECTO_SEGUNDOS = 60;

/** Margen de desfase de reloj admitido al verificar. */
export const TOLERANCIA_RELOJ_SEGUNDOS = 10;

/** Respuesta única ante cualquier fallo de autenticación de servicio. */
export const MENSAJE_SERVICIO_NO_AUTENTICADO = 'Autenticación de servicio requerida.';

/** Claims de un token de servicio. */
export interface ClaimsServicio {
  /** Quien llama: `gateway`, `ms-identidad`, ... */
  iss: string;
  /** A quien va dirigido. Un token para uno no sirve contra otro. */
  aud: string;
  iat?: number;
  exp?: number;
}

export interface OpcionesFirma {
  /** Nombre de este servicio, el que llama. */
  emisor: string;
  /** Nombre del servicio al que se llama. */
  destinatario: string;
  secreto: string | undefined;
  vigenciaSegundos?: number;
}

/** Firma un token de servicio. */
export function firmarTokenDeServicio(opciones: OpcionesFirma): string {
  if (!opciones.secreto) {
    throw new Error(
      'Falta SERVICIO_JWT_SECRET: no se puede firmar una llamada entre servicios sin clave.',
    );
  }

  return jwt.sign({}, opciones.secreto, {
    issuer: opciones.emisor,
    audience: opciones.destinatario,
    expiresIn: opciones.vigenciaSegundos ?? VIGENCIA_POR_DEFECTO_SEGUNDOS,
  });
}

/** Cabeceras listas para una llamada entre servicios. */
export function cabeceraDeServicio(opciones: OpcionesFirma): Record<string, string> {
  return {
    Authorization: `${ESQUEMA_SERVICIO} ${firmarTokenDeServicio(opciones)}`,
  };
}

/** De donde sale el token en la peticion entrante. */
export interface FuenteTokenServicio {
  authorization?: string | undefined;
}

/** Extrae el token del esquema `Servicio`; `undefined` si falta o el esquema es otro. */
export function extraerTokenDeServicio(fuente: FuenteTokenServicio): string | undefined {
  const cabecera = fuente.authorization;
  if (!cabecera) {
    return undefined;
  }

  const [esquema, valor] = cabecera.split(' ');
  if (!valor || esquema === undefined || esquema.toLowerCase() !== ESQUEMA_SERVICIO.toLowerCase()) {
    return undefined;
  }

  return valor;
}

/** Resuelve la clave con la que verificar un token, segun quien lo emitio. */
export type ResolverClave = (emisor: string) => string | undefined;

export interface OpcionesVerificacion {
  /** Nombre de ESTE servicio. Un token dirigido a otro se rechaza. */
  destinatario: string;
  /** Clave unica compartida. Alternativa a `resolverClave`. */
  secreto?: string | undefined;
  /** Clave por emisor. Tiene precedencia sobre `secreto`. */
  resolverClave?: ResolverClave;
  /** Si se indica, solo estos emisores pueden llamar. */
  emisoresPermitidos?: string[];
  toleranciaSegundos?: number;
}

export type ResultadoServicio =
  | { valido: true; claims: ClaimsServicio }
  | { valido: false; estado: number; error: ErrorRespuesta };

const rechazo = (): ResultadoServicio => ({
  valido: false,
  estado: ESTADO_SIN_TOKEN,
  error: crearError(MENSAJE_SERVICIO_NO_AUTENTICADO),
});

/**
 * Verifica un token de servicio. El `iss` sin verificar sólo elige la clave; luego
 * se verifica la firma completa con ella.
 */
export function verificarTokenDeServicio(
  fuente: FuenteTokenServicio,
  opciones: OpcionesVerificacion,
): ResultadoServicio {
  const token = extraerTokenDeServicio(fuente);
  if (!token) {
    return rechazo();
  }

  const sinVerificar = jwt.decode(token) as { iss?: unknown } | null;
  const emisor = typeof sinVerificar?.iss === 'string' ? sinVerificar.iss : null;
  if (!emisor) {
    return rechazo();
  }

  if (opciones.emisoresPermitidos && !opciones.emisoresPermitidos.includes(emisor)) {
    return rechazo();
  }

  const clave = opciones.resolverClave ? opciones.resolverClave(emisor) : opciones.secreto;
  if (!clave) {
    return rechazo();
  }

  try {
    const verificado = jwt.verify(token, clave, {
      audience: opciones.destinatario,
      issuer: emisor,
      clockTolerance: opciones.toleranciaSegundos ?? TOLERANCIA_RELOJ_SEGUNDOS,
    }) as jwt.JwtPayload;

    return {
      valido: true,
      claims: {
        iss: emisor,
        aud: opciones.destinatario,
        ...(verificado.iat !== undefined ? { iat: verificado.iat } : {}),
        ...(verificado.exp !== undefined ? { exp: verificado.exp } : {}),
      },
    };
  } catch {
    return rechazo();
  }
}

// ── Adaptador para Express (tipos estructurales, sin depender de express) ────

interface PeticionMinima {
  headers: Record<string, string | string[] | undefined>;
  servicioLlamante?: ClaimsServicio;
}

interface RespuestaMinima {
  status(codigo: number): { json(cuerpo: unknown): unknown };
}

type Siguiente = () => void;

/** Middleware que exige credencial de servicio. Deja los claims en `req.servicioLlamante`. */
export function exigirServicio(opciones: OpcionesVerificacion) {
  return function autenticacionDeServicio(
    req: PeticionMinima,
    res: RespuestaMinima,
    siguiente: Siguiente,
  ): unknown {
    const authorization = req.headers['authorization'];
    const resultado = verificarTokenDeServicio(
      { authorization: typeof authorization === 'string' ? authorization : undefined },
      opciones,
    );

    if (!resultado.valido) {
      return res.status(resultado.estado).json(resultado.error);
    }

    req.servicioLlamante = resultado.claims;
    return siguiente();
  };
}
