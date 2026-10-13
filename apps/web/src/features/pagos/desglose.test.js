import { desglosar, filtrarCuentas, filtrarMovimientos, totalMovimientos, totales } from './desglose';

const apto = { id_contrato: 'c-apto', id_inmueble: 'apto', Inmueble: { id_inmueble: 'apto', alias: 'Apto 301' } };
const casa = { id_contrato: 'c-casa', id_inmueble: 'casa', Inmueble: { id_inmueble: 'casa', alias: 'Casa Chía' } };

const cuenta = (id, contrato, valor, saldo, estado) => ({
    id_cuenta_cobro: id, id_contrato: contrato.id_contrato, Contrato: contrato, valor, saldo_pendiente: saldo, estado
});

/** El caso de la spec: Apto 301 con una pagada y otra con 500.000 pendientes; Casa Chía con una en mora. */
const cuentas = [
    cuenta('a1', apto, '1500000.00', '0.00', 'PAGADA'),
    cuenta('a2', apto, '1500000.00', '500000.00', 'PARCIAL'),
    cuenta('c1', casa, '2000000.00', '2000000.00', 'EN_MORA')
];

describe('totales', () => {
    test('sin filtros', () => {
        expect(totales(cuentas)).toEqual({ facturado: '5000000', recaudado: '2500000', pendiente: '2500000', en_mora: '2000000' });
    });

    test('de un inmueble', () => {
        expect(totales(filtrarCuentas(cuentas, { inmueble: 'casa' }))).toEqual({
            facturado: '2000000', recaudado: '0', pendiente: '2000000', en_mora: '2000000'
        });
    });

    test('al centavo', () => {
        expect(totales([cuenta('x', apto, '0.10', '0.10', 'PENDIENTE'), cuenta('y', apto, '0.20', '0.20', 'PENDIENTE')]).pendiente).toBe('0.3');
    });
});

describe('filtrarCuentas', () => {
    test('por contrato, y combinado con la pestaña de estado', () => {
        expect(filtrarCuentas(cuentas, { contrato: 'c-apto' }).map((c) => c.id_cuenta_cobro)).toEqual(['a1', 'a2']);
        expect(filtrarCuentas(cuentas, { inmueble: 'apto', estado: 'pendientes' }).map((c) => c.id_cuenta_cobro)).toEqual(['a2']);
        expect(filtrarCuentas(cuentas, { inmueble: 'apto', estado: 'mora' })).toEqual([]);
    });
});

describe('desglosar', () => {
    const sinContrato = { id_cuenta_cobro: 's1', id_contrato: 'c-x', Contrato: null, valor: '100.00', saldo_pendiente: '100.00', estado: 'PENDIENTE' };
    const filas = desglosar([...cuentas, sinContrato]);

    test('una fila por inmueble, con sus contratos, y la cuenta sin contrato en su grupo al final', () => {
        expect(filas.map((f) => [f.inmueble?.alias ?? null, f.sinContrato, f.totales.recaudado])).toEqual([
            ['Apto 301', false, '2500000'],
            ['Casa Chía', false, '0'],
            [null, true, '0']
        ]);
        expect(filas[0].contratos.map((c) => c.id_contrato)).toEqual(['c-apto']);
    });

    test('la suma de las filas es el total', () => {
        const total = totales([...cuentas, sinContrato]);
        const facturadoFilas = filas.reduce((suma, f) => suma + Number(f.totales.facturado), 0);
        expect(String(facturadoFilas)).toBe(total.facturado);
    });
});

describe('movimientos', () => {
    const t = (id, contrato, monto, estado, fecha_pago) => ({
        id_transaccion: id, monto, estado, fecha_pago, CuentaCobro: { id_contrato: contrato.id_contrato, Contrato: contrato }
    });
    const transacciones = [
        t('t1', apto, '1500000.00', 'CONFIRMADA', '2026-03-05T15:00:00Z'),
        t('t2', apto, '1000000.00', 'CONFIRMADA', '2026-04-01T03:00:00Z'),
        t('t3', apto, '300000.00', 'ANULADA', '2026-03-10T15:00:00Z'),
        t('t4', casa, '700000.00', 'CONFIRMADA', '2026-03-12T15:00:00Z')
    ];

    test('el total del contrato suma sólo las confirmadas y cuadra con su recaudado', () => {
        const delApto = filtrarMovimientos(transacciones, { contrato: 'c-apto' });
        expect(delApto).toHaveLength(3);
        expect(totalMovimientos(delApto)).toBe('2500000');
        expect(totalMovimientos(delApto)).toBe(totales(filtrarCuentas(cuentas, { contrato: 'c-apto' })).recaudado);
    });

    test('el rango de fechas va por el día en Bogotá: el pago de medianoche UTC cae el 31 de marzo', () => {
        const marzo = filtrarMovimientos(transacciones, { desde: '2026-03-01', hasta: '2026-03-31' });
        expect(marzo.map((m) => m.id_transaccion)).toEqual(['t1', 't2', 't3', 't4']);
        expect(filtrarMovimientos(transacciones, { inmueble: 'casa', hasta: '2026-03-11' })).toEqual([]);
    });
});
