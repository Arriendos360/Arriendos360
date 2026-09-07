/**
 * Utilidades compartidas entre el gateway y los microservicios.
 *
 * Tres piezas, todas pensadas para que al extraer un servicio no haya que
 * reinventar (ni desviar) comportamiento que el monolito ya define:
 *
 * - `errores`: la forma `{ mensaje }` y los codigos de estado convenidos.
 * - `jwt`: verificacion local del token y de la lista de revocados, replicando
 *   `auth.middleware.js`.
 * - `http`: cliente minimo para llamadas entre servicios.
 *
 * Nadie lo consume todavia: el Dockerfile del gateway construye con contexto
 * `apps/gateway`, asi que `packages/` no entra en la imagen y declarar la
 * dependencia rompe `docker compose up --build`. Se conecta en el paso 3b, que
 * ya tiene que tocar los Dockerfiles para extraer ms-identidad. Los tipos de
 * evento del bus viviran tambien aqui, en el paso 5.
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
  ConsultaRevocacion,
  FuenteToken,
  ResultadoVerificacion,
} from './jwt';

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
