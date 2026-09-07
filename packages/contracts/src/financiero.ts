/**
 * Contratos de interfaz de MS-Financiero.
 *
 * Fuente: Documento Principal, Capitulo 2, seccion "Contratos de interfaz".
 */

import type { FechaHoraISO, MontoCOP, UUID } from './comunes';

/**
 * Tipo de movimiento de una transaccion.
 *
 * El documento solo ejemplifica `INGRESO`. La interseccion `string & {}`
 * mantiene el tipo abierto hasta que el modelo de MS-Financiero fije la lista.
 */
export type TipoTransaccion = 'INGRESO' | (string & {});

/**
 * Medio por el que se recibio el dinero.
 *
 * El documento solo ejemplifica `TRANSFERENCIA`; la lista queda abierta.
 */
export type MedioPago = 'TRANSFERENCIA' | (string & {});

/**
 * Cuerpo de `POST /api/pagos`.
 *
 * Este contrato deja explicita la separacion que el modelo actual mezcla: una
 * `Cuenta_cobro` es la factura mensual que el sistema genera; una `Transaccion`
 * es el movimiento de dinero contra esa factura. Por eso el cuerpo referencia
 * `id_cuenta_cobro` y no un "id_pago".
 *
 * `id_cuenta_cobro` es una referencia interna de MS-Financiero, no cruza
 * frontera de servicio.
 */
export interface RegistrarPagoRequest {
  id_cuenta_cobro: UUID;
  monto: MontoCOP;
  tipo: TipoTransaccion;
  medio_pago: MedioPago;
  fecha_pago: FechaHoraISO;
}
