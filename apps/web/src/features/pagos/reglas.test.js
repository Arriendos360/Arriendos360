import { validarFormularioCobro, validarFormularioPago } from './reglas';

const hoy = '2026-10-12';
const pago = { monto: '600', medio_pago: 'Efectivo', fecha_pago: hoy, observaciones: '' };
const campos = (errores) => errores.map((error) => error.campo);

describe('validarFormularioPago', () => {
    test('un pago de hoy es válido', () => {
        expect(validarFormularioPago(pago, hoy)).toEqual([]);
    });

    test('fecha de mañana y monto "0"', () => {
        expect(campos(validarFormularioPago({ ...pago, monto: '0', fecha_pago: '2026-10-13' }, hoy)))
            .toEqual(['monto', 'fecha_pago']);
    });

    test('sin fecha ni monto', () => {
        expect(campos(validarFormularioPago({ ...pago, monto: null, fecha_pago: '' }, hoy))).toEqual(['monto', 'fecha_pago']);
    });
});

describe('validarFormularioCobro', () => {
    test('sin contrato y con valor no positivo', () => {
        expect(campos(validarFormularioCobro({ id_contrato: '', valor: '0' }))).toEqual(['id_contrato', 'valor']);
    });

    test('un cobro completo es válido', () => {
        expect(validarFormularioCobro({ id_contrato: 'c-1', valor: '1500000' })).toEqual([]);
    });
});
