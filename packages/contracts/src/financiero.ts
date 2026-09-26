/** Contratos de interfaz de MS-Financiero. Sus catálogos van en MAYÚSCULAS. */

import type { FechaHoraISO, FechaISO, MontoCOP, UUID } from './comunes';

/** Estados de una cuenta de cobro. Catálogo cerrado. */
export const ESTADOS_CUENTA_COBRO = ['PENDIENTE', 'PAGADA', 'PARCIAL', 'EN_MORA'] as const;

export type EstadoCuentaCobro = (typeof ESTADOS_CUENTA_COBRO)[number];

/** Es este valor uno de los estados del catalogo? */
export const esEstadoCuentaCobro = (valor: unknown): valor is EstadoCuentaCobro =>
  typeof valor === 'string' && (ESTADOS_CUENTA_COBRO as readonly string[]).includes(valor);

/** Estados de una transacción. Una transacción no se borra: se anula. */
export const ESTADOS_TRANSACCION = ['CONFIRMADA', 'ANULADA'] as const;

export type EstadoTransaccion = (typeof ESTADOS_TRANSACCION)[number];

/** Es este valor uno de los estados del catalogo? */
export const esEstadoTransaccion = (valor: unknown): valor is EstadoTransaccion =>
  typeof valor === 'string' && (ESTADOS_TRANSACCION as readonly string[]).includes(valor);

/** Tipo de movimiento de una transacción. Catálogo cerrado. */
export const TIPOS_TRANSACCION = ['INGRESO'] as const;

export type TipoTransaccion = (typeof TIPOS_TRANSACCION)[number];

/** Es este valor uno de los tipos del catalogo? */
export const esTipoTransaccion = (valor: unknown): valor is TipoTransaccion =>
  typeof valor === 'string' && (TIPOS_TRANSACCION as readonly string[]).includes(valor);

/** Medio por el que se recibió el dinero. Catálogo abierto. */
export type MedioPago = 'TRANSFERENCIA' | (string & {});

/** Lo que ofrece el desplegable. No se valida contra esta lista. */
export const MEDIOS_PAGO_CONOCIDOS = [
  'Transferencia Bancaria',
  'Efectivo',
  'Consignacion',
] as const;

/** Cuerpo de `POST /api/pagos`. Sin `fecha_pago`, se toma el momento del registro. */
export interface RegistrarPagoRequest {
  id_cuenta_cobro: UUID;
  monto: MontoCOP;
  tipo: TipoTransaccion;
  medio_pago: MedioPago;
  fecha_pago?: FechaHoraISO;
  /** Referencia del movimiento, para el comprobante. */
  observaciones?: string;
}

/**
 * Cuerpo de `POST /api/pagos/cuentas-cobro`: alta manual de una cuenta de cobro.
 * Sin `inicio` ni `fin`, se derivan del periodo de corte del contrato.
 */
export interface CrearCuentaCobroRequest {
  id_contrato: UUID;
  valor: MontoCOP;
  inicio?: FechaISO;
  fin?: FechaISO;
  detalle?: string;
}
