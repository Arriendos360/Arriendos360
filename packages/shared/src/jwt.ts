/**
 * Verificación local del JWT de usuario: firma, vigencia, forma y revocación, sin
 * llamar a MS-Identidad en cada petición.
 */

import jwt from 'jsonwebtoken';

import {
  ESTADO_PROHIBIDO,
  ESTADO_SIN_TOKEN,
  type ErrorRespuesta,
  crearError,
} from './errores';

/** Nombres de rol tal como viajan en los claims: en mayusculas. */
export const ROL_PROPIETARIO = 'PROPIETARIO';
export const ROL_INQUILINO = 'INQUILINO';

/** Claims del token de usuario. Un usuario puede tener varios roles. */
export interface ClaimsUsuario {
  /** UUID del usuario. */
  sub: string;
  email: string;
  roles: string[];
  /** UUID unico de este token. */
  jti: string;
  /** `true` mientras el usuario no haya elegido su propia contraseña. */
  debe_cambiar?: boolean;
  /** Emitido en, en segundos desde epoch. Lo agrega `jsonwebtoken`. */
  iat?: number;
  /** Expira en, en segundos desde epoch. Lo agrega `jsonwebtoken`. */
  exp?: number;
}

/** Mensajes literales del middleware. No los cambies sin migrar el frontend. */
export const MENSAJE_SIN_TOKEN = 'Acceso denegado. No se proporcionó un token.';
export const MENSAJE_TOKEN_INVALIDO = 'Token no válido o expirado.';
export const MENSAJE_TOKEN_REVOCADO = 'Sesión cerrada. Inicia sesión de nuevo.';
export const MENSAJE_ROL_INSUFICIENTE =
  'Acceso restringido. Se requiere rol de propietario.';

/** De dónde se lee el token: sólo la cabecera, nunca la query string. */
export interface FuenteToken {
  /** Cabecera `Authorization`, en la forma `"Bearer <token>"`. */
  authorization?: string | undefined;
}

/** Extrae el token del esquema `Bearer`; `undefined` si falta o está mal formado. */
export function extraerToken(fuente: FuenteToken): string | undefined {
  const cabecera = fuente.authorization;
  if (!cabecera) {
    return undefined;
  }

  const [esquema, valor] = cabecera.split(' ');
  if (!valor || esquema === undefined || esquema.toLowerCase() !== 'bearer') {
    return undefined;
  }

  return valor;
}

/** Resultado de verificar un token: valido con claims, o invalido con su error listo. */
export type ResultadoVerificacion =
  | { valido: true; claims: ClaimsUsuario }
  | { valido: false; estado: number; error: ErrorRespuesta };

/** Cadena presente y no vacia. */
function esCadenaConValor(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

/**
 * ¿Tiene la forma de los claims? `sub` y `jti` no vacíos: un `jti` vacío quedaría
 * fuera de la lista de revocados.
 */
function tieneFormaDeClaims(valor: unknown): valor is ClaimsUsuario {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }

  const posible = valor as Record<string, unknown>;

  return (
    esCadenaConValor(posible['sub']) &&
    esCadenaConValor(posible['jti']) &&
    Array.isArray(posible['roles'])
  );
}

/**
 * Verifica firma, vigencia y forma del token.
 * - sin token                        -> `401`
 * - firma mala, expirado o mal formado -> `403`
 */
export function verificarToken(
  fuente: FuenteToken,
  secreto: string | undefined,
): ResultadoVerificacion {
  const token = extraerToken(fuente);

  if (!token) {
    return {
      valido: false,
      estado: ESTADO_SIN_TOKEN,
      error: crearError(MENSAJE_SIN_TOKEN),
    };
  }

  let verificado: unknown;
  try {
    verificado = jwt.verify(token, secreto as jwt.Secret);
  } catch {
    return {
      valido: false,
      estado: ESTADO_PROHIBIDO,
      error: crearError(MENSAJE_TOKEN_INVALIDO),
    };
  }

  if (!tieneFormaDeClaims(verificado)) {
    return {
      valido: false,
      estado: ESTADO_PROHIBIDO,
      error: crearError(MENSAJE_TOKEN_INVALIDO),
    };
  }

  return { valido: true, claims: verificado };
}

/**
 * ¿Dejó de valer el token? Por `jti` revocado (logout) o por `iat` anterior al
 * último cambio de contraseña. Cada servicio la implementa.
 */
export type TokenInvalidado = (claims: ClaimsUsuario) => Promise<boolean>;

/** Verificación completa: firma, forma y revocación. */
export async function verificarTokenConRevocacion(
  fuente: FuenteToken,
  secreto: string | undefined,
  tokenInvalidado: TokenInvalidado,
): Promise<ResultadoVerificacion> {
  const resultado = verificarToken(fuente, secreto);

  if (!resultado.valido) {
    return resultado;
  }

  if (await tokenInvalidado(resultado.claims)) {
    return {
      valido: false,
      estado: ESTADO_SIN_TOKEN,
      error: crearError(MENSAJE_TOKEN_REVOCADO),
    };
  }

  return resultado;
}

/** ¿Tiene el usuario alguno de estos roles? */
export function tieneRol(
  claims: ClaimsUsuario | undefined | null,
  ...roles: string[]
): boolean {
  if (claims === undefined || claims === null || !Array.isArray(claims.roles)) {
    return false;
  }

  return roles.some((rol) => claims.roles.includes(rol));
}

/** ¿Es propietario? */
export function esPropietario(claims: ClaimsUsuario | undefined | null): boolean {
  return tieneRol(claims, ROL_PROPIETARIO);
}

/** ¿Es inquilino? */
export function esInquilino(claims: ClaimsUsuario | undefined | null): boolean {
  return tieneRol(claims, ROL_INQUILINO);
}
