/**
 * Verificacion local del JWT.
 *
 * Replica la logica de `apps/gateway/src/middlewares/auth.middleware.js`,
 * incluidos sus mensajes y codigos de estado, para que al extraer los servicios
 * el comportamiento observable no cambie.
 *
 * "Local" significa que cada servicio verifica la firma con el secreto
 * compartido, sin llamar a MS-Identidad en cada peticion. Esa es la decision del
 * Capitulo 2: sin ella, MS-Identidad seria un punto unico de fallo para toda
 * peticion autenticada del sistema.
 *
 * Verificar la firma en local NO exime de consultar la lista de revocados: un
 * token cuya firma es valida puede corresponder a una sesion ya cerrada. Por eso
 * `verificarTokenConRevocacion` existe aparte, y por eso la consulta se inyecta
 * en vez de traerse aqui una dependencia de base de datos.
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

/**
 * Claims que emite `services/tokenService.js`, segun el Capitulo 2.
 *
 * `roles` es un arreglo porque `RolesUsuario` es muchos a muchos: un usuario
 * puede ser propietario e inquilino a la vez. `jti` es lo que hace posible la
 * revocacion; sin el, cerrar sesion no tendria efecto hasta que el token
 * expirara solo.
 */
export interface ClaimsUsuario {
  /** UUID del usuario. Sustituye al antiguo par `id` + `id_perfil`. */
  sub: string;
  email: string;
  roles: string[];
  /** UUID unico de este token. */
  jti: string;
  /**
   * `true` mientras el usuario no haya elegido su propia contrasena.
   *
   * Lo llevan los usuarios creados por un tercero, que entran con una temporal
   * generada por el servicio. Viaja en el token para que el gateway pueda
   * bloquear la API sin preguntar en cada peticion. Ver docs/adr/0007.
   */
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

/**
 * De donde puede venir el token en una peticion entrante.
 *
 * Solo la cabecera. El fallback por `?token=` desaparecio en el paso 3a: existia
 * para `window.open`, que no puede poner cabeceras, y las descargas de PDF pasan
 * ahora por `fetch` + blob. Un token en la query string queda en los logs del
 * servidor, en el historial del navegador y en la cabecera `Referer`.
 */
export interface FuenteToken {
  /** Cabecera `Authorization`, en la forma `"Bearer <token>"`. */
  authorization?: string | undefined;
}

/**
 * Extrae el token del esquema `Bearer`.
 *
 * Devuelve `undefined` si falta la cabecera, si el esquema no es `Bearer` o si
 * no hay valor despues del esquema.
 */
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
 * ¿Tiene esto la forma de los claims que emitimos hoy?
 *
 * `sub` y `jti` deben ser cadenas NO VACIAS. Lo de "no vacias" no es celo: un
 * `jti` de cadena vacia pasaria la comprobacion de tipo y luego la consulta de
 * revocacion lo trataria como ausente, de modo que el token quedaria fuera de la
 * lista de revocados para siempre. Rechazarlo aqui cierra ese camino.
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
 *
 * Correspondencia con el middleware del gateway:
 * - sin token             -> `401` con {@link MENSAJE_SIN_TOKEN}
 * - firma mala o expirado -> `403` con {@link MENSAJE_TOKEN_INVALIDO}
 * - sin `jti` o sin `roles` -> `403`, porque es un token de la forma anterior al
 *   paso 3a y no se puede revocar.
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
 * Consulta si un token dejo de valer, por el motivo que sea.
 *
 * Recibe los claims completos y no solo el `jti` porque hay DOS formas de
 * invalidar un token y las dos tienen que caber aqui:
 *
 * - **Revocacion individual**, por `jti`: es lo que hace el logout.
 * - **Invalidacion en bloque**, comparando `iat` con la marca de cuando el
 *   usuario cambio su contrasena: al restablecerla caen TODAS sus sesiones de
 *   golpe, sin tener que revocar cada `jti` uno por uno. Es mas barato y cubre
 *   las sesiones que nadie sabia que estaban abiertas, que es justo el caso que
 *   motiva restablecer una contrasena.
 *
 * Se inyecta en vez de implementarse aqui porque cada servicio la resuelve
 * distinto: ms-identidad consulta su base, y el gateway lee su copia en memoria.
 */
export type TokenInvalidado = (claims: ClaimsUsuario) => Promise<boolean>;

/**
 * Verificacion completa: firma, forma y revocacion.
 *
 * Confianza cero (regla dura 7): un servicio hace esto aunque la peticion venga
 * del gateway y el gateway ya lo haya hecho.
 */
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

/**
 * ¿Es propietario?
 *
 * Consulta el arreglo `roles`, no una columna `rol`. Un usuario que sea
 * propietario e inquilino a la vez devuelve `true`, que es justo lo que el
 * modelo canonico permite y el anterior no podia representar.
 */
export function esPropietario(claims: ClaimsUsuario | undefined | null): boolean {
  return tieneRol(claims, ROL_PROPIETARIO);
}

/** ¿Es inquilino? */
export function esInquilino(claims: ClaimsUsuario | undefined | null): boolean {
  return tieneRol(claims, ROL_INQUILINO);
}
