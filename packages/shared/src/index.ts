/**
 * Utilidades compartidas entre el gateway y los microservicios.
 *
 * Tres piezas, todas pensadas para que al extraer un servicio no haya que
 * reinventar (ni desviar) comportamiento que el monolito ya define:
 *
 * - `errores`: la forma `{ mensaje }` y los codigos de estado convenidos.
 * - `jwt`: verificacion local del token, replicando `auth.middleware.js`.
 * - `http`: cliente minimo para llamadas entre servicios.
 *
 * Nadie lo consume todavia (paso 2 de la migracion). Los tipos de evento del bus
 * viviran tambien aqui, en el paso 5.
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
  esPropietario,
  extraerToken,
  verificarToken,
} from './jwt';
export type { ClaimsUsuario, FuenteToken, ResultadoVerificacion } from './jwt';

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
