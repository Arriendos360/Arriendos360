/**
 * MS-Financiero: cuentas de cobro, transacciones y sus PDF.
 *
 * - El saldo NO es una columna: cada cuenta llega con `saldo_pendiente`, derivado
 *   en el servicio (`valor` menos lo `CONFIRMADA`). Esta capa no lo calcula.
 * - `medio_pago` no es `tipo`: «TRANSFERENCIA» es un medio; `tipo` es `INGRESO`.
 * - Registrar, cobrar a mano y anular son del propietario (docs/adr/0006); el
 *   inquilino sólo lee.
 */

import { MEDIOS_PAGO_CONOCIDOS, TIPOS_TRANSACCION } from 'arriendos360-contracts';

import api from '../../services/api';
import { abrirPdf } from '../../services/descargas';
import { cuerpo, montoParaEnviar, soloCampos } from '../comun';

export { MEDIOS_PAGO_CONOCIDOS };

const [TIPO_INGRESO] = TIPOS_TRANSACCION;

/**
 * Lo que leen `registrarPago` y `crearCuentaCobro` en el controlador de
 * ms-financiero. `tipo` y `monto` / `valor` no están: los pone esta capa.
 * Anular no lleva cuerpo: el endpoint no lee ninguno (docs/adr/0016).
 */
export const CAMPOS_PAGO = ['id_cuenta_cobro', 'medio_pago', 'fecha_pago', 'observaciones'];
export const CAMPOS_CUENTA_COBRO = ['id_contrato', 'detalle', 'inicio', 'fin'];

/**
 * `fecha_pago` es un instante (`new Date()` en el servicio). Un día de
 * calendario suelto se leería como medianoche UTC, que en Bogotá es la víspera:
 * se manda a mediodía de Bogotá. Sin fecha, el servicio toma el momento actual.
 */
const fechaPagoParaEnviar = (valor) =>
    /^\d{4}-\d{2}-\d{2}$/.test(valor ?? '') ? `${valor}T17:00:00Z` : valor;

// ── Lectura ───────────────────────────────────────────────────────────────

/** `GET /api/pagos`: las cuentas de cobro de los contratos donde el usuario es parte. */
export const listarCuentasCobro = () => cuerpo(api.get('/pagos'));

/** Transacciones de una cuenta, `CONFIRMADA` y `ANULADA`, la más reciente primero. */
export const transaccionesDeCuenta = (idCuentaCobro) => cuerpo(api.get(`/pagos/${idCuentaCobro}/transacciones`));

// ── Escritura (propietario) ───────────────────────────────────────────────

/**
 * `POST /api/pagos`: registra un abono o el pago completo.
 * `fecha_pago` es opcional (`YYYY-MM-DD` o ISO con hora; sin ella, ahora) y
 * `observaciones` es la referencia que imprime el comprobante (docs/adr/0015).
 */
export const registrarPago = (datos) => {
    const cuerpoPago = soloCampos({ ...datos, fecha_pago: fechaPagoParaEnviar(datos.fecha_pago) }, CAMPOS_PAGO);
    return cuerpo(api.post('/pagos', { ...cuerpoPago, tipo: TIPO_INGRESO, monto: montoParaEnviar(datos.monto) }));
};

/**
 * `POST /api/pagos/cuentas-cobro`: cobro manual fuera del ciclo del motor. Sin
 * `inicio`, el servicio toma el siguiente periodo; el `fin` lo calcula él con el
 * día de corte del contrato. Notifica al inquilino (docs/adr/0019).
 */
export const crearCuentaCobro = (datos) => {
    const cuerpoCuenta = soloCampos(datos, CAMPOS_CUENTA_COBRO);
    return cuerpo(api.post('/pagos/cuentas-cobro', { ...cuerpoCuenta, valor: montoParaEnviar(datos.valor) }));
};

/**
 * `POST /api/pagos/transacciones/:id/anular` (docs/adr/0016). No borra: marca la
 * transacción `ANULADA` y el saldo se recalcula solo. Hay que volver a pedir la
 * cuenta en vez de corregirla en memoria.
 */
export const anularTransaccion = (idTransaccion) => cuerpo(api.post(`/pagos/transacciones/${idTransaccion}/anular`));

// ── PDF ───────────────────────────────────────────────────────────────────

export const abrirRecibo = (idCuentaCobro) => abrirPdf(`/pagos/${idCuentaCobro}/recibo`, `Recibo_${idCuentaCobro}.pdf`);

export const abrirComprobante = (idTransaccion) =>
    abrirPdf(`/pagos/transacciones/${idTransaccion}/comprobante`, `Comprobante_${idTransaccion}.pdf`);
