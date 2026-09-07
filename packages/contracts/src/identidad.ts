/**
 * Contratos de interfaz de MS-Identidad.
 *
 * Fuente: Documento Principal, Capitulo 2, secciones "Contratos de interfaz" y
 * "Modulo de seguridad". Los nombres de campo son los del documento, sin
 * traducir ni normalizar.
 */

import type { FechaHoraISO, UUID } from './comunes';

/**
 * Cuerpo de `POST /api/auth/registro`.
 *
 * Ojo con dos cosas al implementar el servicio:
 *
 * - El campo es `email`, no `correo`.
 * - El rol NO viaja en el cuerpo. La asignacion en `RolesUsuario` se maneja
 *   internamente, porque aceptarlo del cliente seria un agujero de
 *   autorizacion: cualquiera podria darse de alta como inquilino sin contrato.
 *   El registro publico crea siempre PROPIETARIO.
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

/**
 * Usuario que devuelve el login.
 *
 * `rol` es SINGULAR y es el principal del usuario. No contradice al arreglo
 * `roles` de los claims: son dos audiencias. Los claims le hablan al gateway y a
 * los servicios, que necesitan la lista completa para autorizar; esto le habla a
 * la SPA, que solo necesita saber que barra lateral pintar al entrar.
 */
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

/**
 * Claims del JWT.
 *
 * `POST /api/auth/logout` no lleva cuerpo: el token va en `Authorization` y el
 * servicio anota su `jti` en `TokensRevocados` hasta `exp`.
 */
export interface ClaimsToken {
  /** UUID del usuario. */
  sub: UUID;
  email: string;
  /** En mayusculas: `["PROPIETARIO"]`, `["PROPIETARIO","INQUILINO"]`. */
  roles: string[];
  /** UUID unico del token. Sin el no habria forma de revocarlo. */
  jti: UUID;
  /** Expiracion en segundos desde epoch. Vigencia fijada en 3600 s. */
  exp: number;
}

/** Fila de `TokensRevocados`. Tabla operativa, sin columnas de auditoria. */
export interface TokenRevocado {
  jti: UUID;
  /**
   * Expiracion natural del token. La verificacion filtra por
   * `expira_en > NOW()`, de modo que una fila vencida deja de tener efecto y no
   * hace falta barrido programado.
   */
  expira_en: FechaHoraISO;
}
