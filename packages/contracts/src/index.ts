/** DTOs compartidos. Los catálogos cerrados emiten JavaScript; lo demás son tipos. */

export type {
  DiaDelMes,
  FechaHoraISO,
  FechaISO,
  MontoCOP,
  UUID,
} from './comunes';

export type {
  ClaimsToken,
  LoginRequest,
  LoginResponse,
  RegistroUsuarioRequest,
  TokenRevocado,
  UsuarioLogin,
} from './identidad';

export {
  ESTADOS_INMUEBLE,
  LONGITUD_MAXIMA_ALIAS,
  TIPOS_INMUEBLE,
  esEstadoInmueble,
  esTipoInmueble,
} from './inmuebles';

export type {
  CrearInmuebleRequest,
  EstadoInmueble,
  TipoInmueble,
} from './inmuebles';

export {
  ANIOS_PLENA_VOLUNTAD,
  CAMPOS_CONTRATO_EDITABLES,
  CAUSALES_PREAVISO_ARRENDADOR,
  DIAS_RECORDATORIO_PREAVISO,
  ESTADOS_CONTRATO,
  FUNDAMENTO_PREAVISO,
  IPC_ANUAL,
  MESES_PREAVISO_TERMINACION,
  MOTIVOS_CANCELACION,
  TAMANO_MAXIMO_ANEXO_MB,
  TIPOS_ANEXO_CONOCIDOS,
  esEstadoContrato,
} from './contratos';

export type {
  CancelarContratoRequest,
  CausalPreaviso,
  ClaveMotivoCancelacion,
  CrearAnexoFormData,
  CrearContratoRequest,
  EstadoContrato,
  MotivoCancelacion,
  ParteContrato,
  PartePreaviso,
  SituacionContrato,
  TipoAnexo,
} from './contratos';

export {
  ESTADOS_CUENTA_COBRO,
  ESTADOS_TRANSACCION,
  MEDIOS_PAGO_CONOCIDOS,
  TIPOS_TRANSACCION,
  esEstadoCuentaCobro,
  esEstadoTransaccion,
  esTipoTransaccion,
} from './financiero';

export type {
  CrearCuentaCobroRequest,
  EstadoCuentaCobro,
  EstadoTransaccion,
  MedioPago,
  RegistrarPagoRequest,
  TipoTransaccion,
} from './financiero';

export { LONGITUD_MINIMA_CONTRASENA } from './validacion/reglas';

export {
  errorDeValidacion,
  validarAltaInquilino,
  validarCancelacion,
  validarContrato,
  validarCuentaCobro,
  validarInmueble,
  validarPago,
  validarRegistro,
} from './validacion/cuerpos';

export type { ErrorCampo, ErrorValidacion, Validacion } from './validacion/cuerpos';
