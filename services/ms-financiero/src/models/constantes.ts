/**
 * Constantes del modelo financiero: nombres para los valores de los catálogos de
 * `packages/contracts`.
 */

export {
  ESTADOS_CUENTA_COBRO,
  ESTADOS_TRANSACCION,
  TIPOS_TRANSACCION,
  esEstadoCuentaCobro,
  esEstadoTransaccion,
  esTipoTransaccion,
} from 'arriendos360-contracts';
export type {
  EstadoCuentaCobro,
  EstadoTransaccion,
  MedioPago,
  TipoTransaccion,
} from 'arriendos360-contracts';

export const ESTADO_CUENTA_PENDIENTE = 'PENDIENTE';
export const ESTADO_CUENTA_PAGADA = 'PAGADA';
export const ESTADO_CUENTA_PARCIAL = 'PARCIAL';
export const ESTADO_CUENTA_EN_MORA = 'EN_MORA';

export const ESTADO_TRANSACCION_CONFIRMADA = 'CONFIRMADA';
export const ESTADO_TRANSACCION_ANULADA = 'ANULADA';

/** Tipo de todo movimiento: dinero que entra. */
export const TIPO_TRANSACCION_INGRESO = 'INGRESO';

/** Estado de contrato que el motor pide a ms-contratos. */
export const ESTADO_CONTRATO_ACTIVO = 'activo';

/** Autor de los cambios que no hace una persona. Mismo UUID en todos los servicios. */
export const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';
