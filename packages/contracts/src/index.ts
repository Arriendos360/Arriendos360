/**
 * DTOs compartidos de Arriendos360.
 *
 * Traduccion literal de los contratos de interfaz del Documento Principal
 * (Capitulo 2). Es la referencia unica de la forma de cada payload.
 *
 * Casi todo son tipos, que se borran al compilar. La excepcion son los
 * catalogos cerrados de `inmuebles.ts`, que emiten JavaScript porque hay que
 * poder recorrerlos en runtime para validar y para pintar un desplegable.
 */

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

/**
 * Inmuebles es el unico modulo que exporta VALORES y no solo tipos: el catalogo
 * de tipos de inmueble tiene que ser el mismo en el servicio, en el frontend y
 * en la migracion. Ver la cabecera de `inmuebles.ts`.
 */
export {
  ESTADOS_INMUEBLE,
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

export type {
  MedioPago,
  RegistrarPagoRequest,
  TipoTransaccion,
} from './financiero';
