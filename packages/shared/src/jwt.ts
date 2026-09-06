/**
 * Verificacion local del JWT.
 *
 * Replica exactamente la logica de `apps/gateway/src/middlewares/auth.middleware.js`,
 * incluidos sus mensajes y codigos de estado, para que al extraer los servicios
 * el comportamiento observable no cambie.
 *
 * "Local" significa que cada servicio verifica la firma con el secreto
 * compartido, sin llamar a MS-Identidad en cada peticion. Esa es la decision que
 * el Capitulo 2 fija para el paso 3 de la migracion.
 */

import jwt from 'jsonwebtoken';

import {
  ESTADO_PROHIBIDO,
  ESTADO_SIN_TOKEN,
  type ErrorRespuesta,
  crearError,
} from './errores';

/**
 * Claims que el monolito firma hoy en `auth.controller.js`.
 *
 * `id` e `id_perfil` estan tipados de forma laxa a proposito: hoy son enteros de
 * Sequelize y el modelo canonico los migra a UUID. Cerrar el tipo a `number`
 * obligaria a tocarlo de nuevo en el paso 3.
 */
export interface ClaimsUsuario {
  id: number | string;
  correo: string;
  rol: string;
  id_perfil: number | string | null;
  /** Emitido en, en segundos desde epoch. Lo agrega `jsonwebtoken`. */
  iat?: number;
  /** Expira en, en segundos desde epoch. Lo agrega `jsonwebtoken`. */
  exp?: number;
}

/** Mensajes literales del middleware actual. No los cambies sin migrar el frontend. */
export const MENSAJE_SIN_TOKEN = 'Acceso denegado. No se proporcionó un token.';
export const MENSAJE_TOKEN_INVALIDO = 'Token no válido o expirado.';
export const MENSAJE_ROL_INSUFICIENTE =
  'Acceso restringido. Se requiere rol de propietario.';

/** De donde puede venir el token en una peticion entrante. */
export interface FuenteToken {
  /** Cabecera `Authorization`, tipicamente `"Bearer <token>"`. */
  authorization?: string | undefined;
  /**
   * Parametro `?token=` de la query string.
   *
   * Existe porque las descargas de PDF se abren con `window.open`, que no puede
   * poner cabeceras. Esta registrado como trampa conocida: queda en los logs del
   * servidor y en el historial del navegador, y se reemplaza por URLs firmadas
   * al pasar a HTTPS.
   */
  tokenQuery?: string | undefined;
}

/**
 * Extrae el token de la cabecera o, si no esta, de la query string.
 *
 * Reproduce `(authHeader && authHeader.split(' ')[1]) || req.query.token`,
 * incluida la peculiaridad de que una cabecera sin espacio (`"abc"` en vez de
 * `"Bearer abc"`) no produce token y hace caer el fallback a la query.
 */
export function extraerToken(fuente: FuenteToken): string | undefined {
  const desdeCabecera = fuente.authorization?.split(' ')[1];
  return desdeCabecera || fuente.tokenQuery || undefined;
}

/** Resultado de verificar un token: valido con claims, o invalido con su error listo. */
export type ResultadoVerificacion =
  | { valido: true; claims: ClaimsUsuario }
  | { valido: false; estado: number; error: ErrorRespuesta };

/**
 * Verifica la firma y la vigencia del token.
 *
 * Devuelve un resultado en vez de lanzar, para que quien llame decida si
 * responde HTTP, corta un flujo interno o registra el fallo.
 *
 * Correspondencia con el middleware actual:
 * - sin token  -> `401` con {@link MENSAJE_SIN_TOKEN}
 * - firma mala o expirado -> `403` con {@link MENSAJE_TOKEN_INVALIDO}
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

  // El middleware actual pasa `process.env.JWT_SECRET` sin comprobarlo; si falta,
  // `jwt.verify` lanza y termina en el mismo 403. Se replica ese comportamiento
  // en vez de introducir un 500 que hoy no existe.
  try {
    const verificado = jwt.verify(token, secreto as jwt.Secret);
    return { valido: true, claims: verificado as unknown as ClaimsUsuario };
  } catch {
    return {
      valido: false,
      estado: ESTADO_PROHIBIDO,
      error: crearError(MENSAJE_TOKEN_INVALIDO),
    };
  }
}

/**
 * Replica `esPropietario` del middleware actual.
 *
 * Se queda con la comparacion literal contra `'propietario'`. En el modelo
 * canonico el rol pasa a vivir en `RolesUsuario` y esto habra que revisarlo en
 * el paso 3.
 */
export function esPropietario(claims: ClaimsUsuario | undefined | null): boolean {
  return claims !== undefined && claims !== null && claims.rol === 'propietario';
}
