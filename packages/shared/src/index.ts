/**
 * Utilidades compartidas por el gateway y los servicios:
 *
 * - `errores`: la forma `{ mensaje }` y los códigos de estado.
 * - `jwt`: verificación del token de usuario y de su revocación.
 * - `servicio`: autenticación entre servicios para `/interno`.
 * - `revocacion`: copia en memoria de lo que invalida tokens.
 * - Bus de eventos: `eventos` (tipos), `salida` (productor), `entrada`
 *   (consumidor) y `entrega` (transporte).
 * - `fechas`: calendario del arrendamiento.
 * - `entorno`: lectura de variables de entorno.
 * - `origen`: IP del cliente firmada por el gateway.
 */

export {
  ESTADO_NO_ENCONTRADO,
  ESTADO_PROHIBIDO,
  ESTADO_PUERTA_ENLACE,
  ESTADO_SIN_TOKEN,
  ESTADO_VALIDACION,
  crearError,
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

// ── Bus de eventos ───────────────────────────────────────────────────────────

export {
  TIPO_CONTRASENA_TEMPORAL_EMITIDA,
  TIPO_CONTRATO_FINALIZADO,
  TIPO_CONTRATO_FORMALIZADO,
  TIPO_CUENTA_COBRO_EN_MORA,
  TIPO_CUENTA_COBRO_GENERADA,
  TIPO_CUENTA_COBRO_POR_VENCER,
  TIPO_RECUPERACION_SOLICITADA,
  VERSION_EVENTO,
  crearSobre,
  esSobreEvento,
} from './eventos';
export type {
  CargaPorTipo,
  ContrasenaTemporalEmitida,
  ContratoFinalizado,
  ContratoFormalizado,
  CuentaCobroEnMora,
  CuentaCobroGenerada,
  CuentaCobroPorVencer,
  RecuperacionSolicitada,
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
  validarTipoDeEvento,
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

// ── Calendario del arrendamiento ─────────────────────────────────────────────
export {
  ZONA_NEGOCIO,
  comoISO,
  diaDeCorte,
  diaEnMes,
  diaLimiteDesde,
  diasEntre,
  esBisiesto,
  fechaEnMes,
  fechaInicioCorteDesde,
  hoyEnZonaNegocio,
  mesSiguiente,
  partesDeISO,
  periodoDeCorte,
  periodoQueEmpiezaEn,
  soloFecha,
  sumarDias,
  ultimoDiaDelMes,
} from './fechas';
export type { FechaISO as FechaCalendario, Periodo } from './fechas';

// ── Variables de entorno ─────────────────────────────────────────────────────
export {
  ErrorDeEntorno,
  enteroDeEntorno,
  enteroOpcionalDeEntorno,
  faltantesDeEntorno,
  leerEntorno,
  siNoDeEntorno,
  textoDeEntorno,
  validarEntorno,
} from './entorno';
export type { Entorno } from './entorno';

// ── Origen del cliente ───────────────────────────────────────────────────────
export {
  CABECERA_ORIGEN_CLIENTE,
  VIGENCIA_ORIGEN_SEGUNDOS,
  audienciaDeOrigen,
  firmarOrigenCliente,
  verificarOrigenCliente,
} from './origen';
export type { OpcionesFirmaOrigen, OpcionesVerificacionOrigen } from './origen';

export { ESPACIO_EVENTOS, idDeEventoDeterminista } from './eventos';
