import { filaDeHistorial, indemnizacionSugerida, motivosPara, resumenDeMora, textoDeMora } from './estado';

describe('indemnizacionSugerida', () => {
    test.each([
        ['unilateral_inquilino', { valor: '4500000.00', a_cargo_de: 'INQUILINO' }],
        ['unilateral_propietario', { valor: '4500000.00', a_cargo_de: 'PROPIETARIO' }],
        ['mutuo_acuerdo', { valor: '0.00', a_cargo_de: '' }],
        ['incumplimiento_inquilino', { valor: '0.00', a_cargo_de: 'INQUILINO' }]
    ])('%s con canon de 1.500.000', (motivo, esperado) => {
        expect(indemnizacionSugerida(motivo, '1500000.00')).toEqual(esperado);
    });

    test('con centavos, sin errores de redondeo', () => {
        expect(indemnizacionSugerida('unilateral_inquilino', '1234567.89').valor).toBe('3703703.67');
    });

    test('sin motivo no hay sugerido', () => {
        expect(indemnizacionSugerida('', '1500000')).toEqual({ valor: null, a_cargo_de: '' });
    });
});

describe('motivosPara', () => {
    test('la unilateral del arrendador sólo en la prórroga', () => {
        expect(motivosPara('vigente').map((m) => m.valor)).not.toContain('unilateral_propietario');
        expect(motivosPara('renovado').map((m) => m.valor)).toContain('unilateral_propietario');
    });
});

describe('mora', () => {
    const cuentas = [
        { estado: 'EN_MORA', saldo_pendiente: '1300000.00' },
        { estado: 'EN_MORA', saldo_pendiente: 1300000 },
        { estado: 'PENDIENTE', saldo_pendiente: '900000.00' }
    ];

    test('cuenta sólo las cuentas en mora y suma sus saldos', () => {
        expect(resumenDeMora(cuentas)).toEqual({ cantidad: 2, total: '2600000.00' });
    });

    test('el texto dice cuántas y por cuánto', () => {
        expect(textoDeMora({ cuentas })).toMatch(/^2 cuentas en mora por \$ 2\.600\.000\./);
        expect(textoDeMora({ cuentas: [cuentas[0]] })).toMatch(/^1 cuenta en mora por \$ 1\.300\.000\./);
    });

    test('sin mora lo dice, y si la consulta falla no afirma que no la hay', () => {
        expect(textoDeMora({ cuentas: [cuentas[2]] })).toBe('No hay cuentas en mora.');
        expect(textoDeMora({ error: new Error('502') })).toBe('No se pudo comprobar si hay cuentas en mora.');
        expect(textoDeMora({ cargando: true })).toMatch(/Comprobando/);
    });
});

describe('filaDeHistorial', () => {
    test('un cambio de canon', () => {
        expect(filaDeHistorial({
            campo: 'canon', valor_anterior: '1500000.00', valor_nuevo: '1578000.00', cambiado_en: '2026-10-13T20:00:00.000Z'
        })).toEqual({
            fecha: '13 oct 2026, 15:00', campo: 'Canon', anterior: '$ 1.500.000', nuevo: '$ 1.578.000', detalle: null
        });
    });

    test('una cancelación con su motivo y la indemnización', () => {
        const fila = filaDeHistorial({
            campo: 'estado', valor_anterior: 'activo', valor_nuevo: 'cancelado', cambiado_en: '2026-10-13T20:00:00.000Z',
            motivo: 'unilateral_inquilino', indemnizacion: '4500000.00', indemnizacion_a_cargo_de: 'INQUILINO'
        });
        expect(fila).toMatchObject({ campo: 'Estado', anterior: 'Activo', nuevo: 'Cancelado' });
        expect(fila.detalle).toBe('Terminación unilateral del arrendatario, indemnización de $ 4.500.000 a cargo del arrendatario.');
    });

    test('sin valor anterior pinta una raya', () => {
        expect(filaDeHistorial({ campo: 'info_contrato', valor_anterior: null, valor_nuevo: 'Otrosí' }).anterior).toBe('—');
    });
});
