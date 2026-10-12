/** Reglas de los formularios de pago y de cobro. */

import { validarCuentaCobro, validarPago } from 'arriendos360-contracts';

/** Pago. La fecha, que el servicio deja opcional, en la pantalla se pide. `hoy` es `hoyEnBogota()`. */
export const validarFormularioPago = (form, hoy) => [
    ...validarPago(form, hoy).errores,
    ...(form.fecha_pago ? [] : [{ campo: 'fecha_pago', mensaje: 'Indica la fecha del pago.' }])
];

/** Cobro manual: el contrato elegido y el valor. */
export const validarFormularioCobro = (form) => [
    ...(form.id_contrato ? [] : [{ campo: 'id_contrato', mensaje: 'Elige el contrato.' }]),
    ...validarCuentaCobro(form).errores
];
