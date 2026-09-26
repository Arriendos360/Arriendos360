/**
 * MS-Financiero: cuentas de cobro, transacciones y sus PDF.
 *
 * - Cada cuenta llega con `saldo_pendiente`, calculado en el servicio.
 * - `medio_pago` no es `tipo`: «TRANSFERENCIA» es un medio; `tipo` es `INGRESO`.
 * - Registrar, cobrar a mano y anular son del propietario; el inquilino sólo lee.
 */

import { MEDIOS_PAGO_CONOCIDOS, TIPOS_TRANSACCION } from 'arriendos360-contracts';

import api from '../../services/api';
import { abrirPdf } from '../../services/descargas';
import { cuerpo, montoParaEnviar, soloCampos } from '../comun';

export { MEDIOS_PAGO_CONOCIDOS };

const [TIPO_INGRESO] = TIPOS_TRANSACCION;

/** Campos del cuerpo; `tipo` y `monto`/`valor` los pone esta capa. */
export const CAMPOS_PAGO = ['id_cuenta_cobro', 'medio_pago', 'fecha_pago', 'observaciones'];
export const CAMPOS_CUENTA_COBRO = ['id_contrato', 'detalle', 'inicio', 'fin'];

/**
 * `fecha_pago` es un instante: un día suelto se manda a mediodía de Bogotá para
 * no caer en la víspera. Sin fecha, el servicio toma el momento actual.
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
 * `POST /api/pagos`: registra un abono o el pago completo. `observaciones` es la
 * referencia que imprime el comprobante.
 */
export const registrarPago = (datos) => {
    const cuerpoPago = soloCampos({ ...datos, fecha_pago: fechaPagoParaEnviar(datos.fecha_pago) }, CAMPOS_PAGO);
    return cuerpo(api.post('/pagos', { ...cuerpoPago, tipo: TIPO_INGRESO, monto: montoParaEnviar(datos.monto) }));
};

/**
 * `POST /api/pagos/cuentas-cobro`: cobro manual. Sin `inicio`, el servicio toma
 * el siguiente periodo. Notifica al inquilino.
 */
export const crearCuentaCobro = (datos) => {
    const cuerpoCuenta = soloCampos(datos, CAMPOS_CUENTA_COBRO);
    return cuerpo(api.post('/pagos/cuentas-cobro', { ...cuerpoCuenta, valor: montoParaEnviar(datos.valor) }));
};

/**
 * `POST /api/pagos/transacciones/:id/anular`. Marca la transacción `ANULADA`; hay
 * que volver a pedir la cuenta para ver el saldo nuevo.
 */
export const anularTransaccion = (idTransaccion) => cuerpo(api.post(`/pagos/transacciones/${idTransaccion}/anular`));

// ── PDF ───────────────────────────────────────────────────────────────────

export const abrirRecibo = (idCuentaCobro) => abrirPdf(`/pagos/${idCuentaCobro}/recibo`, `Recibo_${idCuentaCobro}.pdf`);

export const abrirComprobante = (idTransaccion) =>
    abrirPdf(`/pagos/transacciones/${idTransaccion}/comprobante`, `Comprobante_${idTransaccion}.pdf`);
