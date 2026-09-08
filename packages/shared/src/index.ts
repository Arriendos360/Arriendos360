/**
 * Utilidades compartidas entre el gateway y los microservicios.
 *
 * Piezas, todas pensadas para que al extraer un servicio no haya que
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
 * Y el bus de eventos, que es lo que agrega el paso 5. Son cuatro modulos
 * porque son cuatro responsabilidades distintas, y separarlas es lo que permite
 * probar cada una sin las otras:
 *
 * - `eventos`: los TIPOS. El sobre comun y la carga de cada evento.
 * - `salida`: el lado del PRODUCTOR. Tabla de salida (outbox) y publicador.
 * - `entrada`: el lado del CONSUMIDOR. Bitacora de procesados e idempotencia.
 * - `entrega`: el TRANSPORTE. Como sale el evento hacia quien escucha.
 *
 * Lo consumen el gateway, ms-identidad y ms-inmuebles.
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

// ── Bus de eventos ───────────────────────────────────────────────────────────

export {
  TIPO_CONTRATO_FINALIZADO,
  TIPO_CONTRATO_FORMALIZADO,
  VERSION_EVENTO,
  crearSobre,
  esSobreEvento,
} from './eventos';
export type {
  CargaPorTipo,
  ContratoFinalizado,
  ContratoFormalizado,
  SobreDesconocido,
  SobreEvento,
  SobreOpaco,
  TipoEvento,
} from './eventos';

export { comoConexion, filasDe, validarNombreDeTabla } from './sql';
export type { ConexionSql, OpcionesSql } from './sql';

export {
  ESPERA_BASE_MS,
  ESPERA_MAXIMA_MS,
  INTERVALO_PUBLICACION_MS,
  MAX_INTENTOS_POR_DEFECTO,
  SALIDA_APARTADO,
  SALIDA_ENTREGADO,
  SALIDA_PENDIENTE,
  TAMANO_LOTE_POR_DEFECTO,
  crearAlmacenSalidaSql,
  crearPublicador,
} from './salida';
export type {
  AlmacenSalida,
  Entregar,
  EstadoPublicador,
  EstadoSalida,
  FilaSalida,
  OpcionesPublicador,
  OpcionesRegistro,
  Publicador,
  ResultadoCiclo,
} from './salida';

export { crearConsumidor } from './entrada';
export type {
  Consumidor,
  ContextoManejo,
  Manejador,
  OpcionesConsumidor,
  RespuestaEvento,
  ResultadoProceso,
} from './entrada';

export { RUTA_EVENTOS, TIMEOUT_ENTREGA_MS, crearEntregaHttp } from './entrega';
export type { OpcionesEntregaHttp, Suscriptor } from './entrega';
