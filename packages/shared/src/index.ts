/**
 * Utilidades compartidas entre el gateway y los microservicios.
 *
 * Cinco piezas, todas pensadas para que al extraer un servicio no haya que
 * reinventar (ni desviar) comportamiento que el monolito ya define:
 *
 * - `errores`: la forma `{ mensaje }` y los codigos de estado convenidos.
 * - `jwt`: verificacion local del token y de la lista de revocados, replicando
 *   `auth.middleware.js`.
 * - `http`: cliente minimo para llamadas entre servicios.
 * - `servicio`: autenticacion ENTRE servicios para los endpoints `/interno`,
 *   con las dos mitades: firmar la llamada y verificarla.
 * - `revocacion`: la copia en memoria de lo que invalida tokens, para que cada
 *   servicio pueda comprobar la revocacion sin un salto de red por peticion.
 *
 * Lo consumen el gateway, ms-identidad y ms-inmuebles. Los tipos de evento del
 * bus viviran tambien aqui, en el paso 5.
 */

export {
  ESTADO_NO_ENCONTRADO,
  ESTADO_PROHIBIDO,
  ESTADO_PUERTA_ENLACE,
  ESTADO_SIN_TOKEN,
  ESTADO_VALIDACION,
  ErrorHttp,
  crearError,
  esErrorRespuesta,
} from './errores';
export type { ErrorRespuesta } from './errores';

export {
  MENSAJE_ROL_INSUFICIENTE,
  MENSAJE_SIN_TOKEN,
  MENSAJE_TOKEN_INVALIDO,
  MENSAJE_TOKEN_REVOCADO,
  ROL_INQUILINO,
  ROL_PROPIETARIO,
  esInquilino,
  esPropietario,
  extraerToken,
  tieneRol,
  verificarToken,
  verificarTokenConRevocacion,
} from './jwt';
export type {
  ClaimsUsuario,
  TokenInvalidado,
  FuenteToken,
  ResultadoVerificacion,
} from './jwt';

export {
  ESQUEMA_SERVICIO,
  MENSAJE_SERVICIO_NO_AUTENTICADO,
  TOLERANCIA_RELOJ_SEGUNDOS,
  VIGENCIA_POR_DEFECTO_SEGUNDOS,
  cabeceraDeServicio,
  exigirServicio,
  extraerTokenDeServicio,
  firmarTokenDeServicio,
  verificarTokenDeServicio,
} from './servicio';
export type {
  ClaimsServicio,
  FuenteTokenServicio,
  OpcionesFirma,
  OpcionesVerificacion,
  ResolverClave,
  ResultadoServicio,
} from './servicio';

export {
  INTERVALO_POR_DEFECTO_MS,
  crearCacheInvalidacion,
} from './revocacion';
export type {
  CacheInvalidacion,
  EntradaRevocada,
  EntradaSesion,
  EstadoCache,
  Invalidaciones,
  OpcionesCache,
} from './revocacion';

export {
  TIMEOUT_POR_DEFECTO_MS,
  crearClienteHttp,
  mensajeDeError,
} from './http';
export type {
  ClienteHttp,
  MetodoHttp,
  OpcionesCliente,
  OpcionesPeticion,
  RespuestaServicio,
} from './http';
