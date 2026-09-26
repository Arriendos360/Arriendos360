/** Contratos de interfaz de MS-Identidad. */

import type { FechaHoraISO, UUID } from './comunes';

/**
 * Cuerpo de `POST /api/auth/registro`. El rol no viaja en el cuerpo: el registro
 * público crea siempre PROPIETARIO.
 */
export interface RegistroUsuarioRequest {
  nombres: string;
  apellidos: string;
  email: string;
  contrasena: string;
  telefono: string;
  documento: string;
}

/** Cuerpo de `POST /api/auth/login`. Ruta publica. */
export interface LoginRequest {
  email: string;
  contrasena: string;
}

/** Usuario que devuelve el login. `rol` es el principal, para la SPA. */
export interface UsuarioLogin {
  id: UUID;
  rol: string;
}

/** Respuesta de `POST /api/auth/login`. */
export interface LoginResponse {
  token: string;
  /** Esquema de autorizacion. Hoy siempre `"Bearer"`. */
  tipo_token: string;
  /** Momento absoluto en que el token deja de servir. */
  expiracion: FechaHoraISO;
  usuario: UsuarioLogin;
}

/** Claims del JWT. */
export interface ClaimsToken {
  /** UUID del usuario. */
  sub: UUID;
  email: string;
  /** En mayusculas: `["PROPIETARIO"]`, `["PROPIETARIO","INQUILINO"]`. */
  roles: string[];
  /** UUID único del token, para revocarlo. */
  jti: UUID;
  /** Expiración en segundos desde epoch. */
  exp: number;
}

/** Fila de `TokensRevocados`. */
export interface TokenRevocado {
  jti: UUID;
  /** Expiración natural del token; pasada esa fecha la fila deja de contar. */
  expira_en: FechaHoraISO;
}
