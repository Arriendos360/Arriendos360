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
 * Y `fechas`, que agrega el paso 6d: la regla del dia 31 y la regla del periodo,
 * que ms-contratos y Financiero comparten desde que dejaron de vivir en el mismo
 * proceso.
 *
 * Y `entorno`: la lectura de variables de entorno, con la cadena vacia tratada como
 * ausencia y la validacion de las obligatorias al arrancar.
 *
 * Lo consumen el gateway y los cinco servicios. Desde el paso 7 los cinco:
 * ms-notificaciones hereda el consumidor tal cual, y ms-identidad y
 * ms-financiero heredan el productor — la tercera y la cuarta tabla de salida
 * del sistema, sin una linea de mecanismo nuevo. Que eso costara una llamada a
 * `crearAlmacenSalidaSql` y otra a `crearPublicador` es el argumento a favor de
 * que el bus viviera aqui desde el paso 5.
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
//
// Subio aqui en el paso 6d. Lo comparten ms-contratos, que deriva las dos
// fechas del ciclo de facturacion, y Financiero, que construye el periodo de
// cada cuenta de cobro y cuenta los dias de mora. Al separarse en servicios
// distintos, la alternativa era duplicar la regla del dia 31 — y una regla de
// calendario mal copiada no se ve en pantalla, se ve en un recibo que sale
// tarde en febrero. Ver la cabecera de `fechas.ts`.
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
//
// Compose y `dotenv` dejan `VAR=` como cadena vacia, y `process.env.VAR ?? defecto`
// la deja pasar. Ningun servicio lee `process.env` con `??` o `||`: lo hace con esto.
// Ver la cabecera de `entorno.ts`.
export {
  ErrorDeEntorno,
  enteroDeEntorno,
  enteroOpcionalDeEntorno,
  faltantesDeEntorno,
  leerEntorno,
  textoDeEntorno,
  validarEntorno,
} from './entorno';
export type { Entorno } from './entorno';

// ── Origen del cliente ───────────────────────────────────────────────────────
//
// La IP que ve el gateway, firmada para el servicio de destino. `X-Forwarded-For`
// lo puede escribir el cliente; esto no. Ver la cabecera de `origen.ts`.
export {
  CABECERA_ORIGEN_CLIENTE,
  VIGENCIA_ORIGEN_SEGUNDOS,
  audienciaDeOrigen,
  firmarOrigenCliente,
  verificarOrigenCliente,
} from './origen';
export type { OpcionesFirmaOrigen, OpcionesVerificacionOrigen } from './origen';

// Identificador de evento derivado del hecho, para avisos que no escriben nada en el
// dominio y tienen que poder anotarse dos veces sin duplicarse. Ver `eventos.ts`.
export { ESPACIO_EVENTOS, idDeEventoDeterminista } from './eventos';
