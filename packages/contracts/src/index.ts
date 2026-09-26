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
  ESTADOS_CONTRATO,
  TAMANO_MAXIMO_ANEXO_MB,
  TIPOS_ANEXO_CONOCIDOS,
  esEstadoContrato,
} from './contratos';

export type {
  CrearAnexoFormData,
  CrearContratoRequest,
  EstadoContrato,
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
