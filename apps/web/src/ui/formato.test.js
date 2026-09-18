import {
    aDecimal,
    dineroParaEditar,
    formatearDinero,
    formatearFecha,
    formatearFechaHora,
    hoyEnBogota,
    leerDinero
} from './formato';

describe('dinero', () => {
    test('normaliza números y cadenas NUMERIC sin pasar por float', () => {
        expect(aDecimal('1500000.00')).toBe('1500000');
        expect(aDecimal(1500000.5)).toBe('1500000.5');
        expect(aDecimal('0.10')).toBe('0.1');
        expect(aDecimal('-0.00')).toBe('0');
        expect(aDecimal('abc')).toBeNull();
        expect(aDecimal(null)).toBeNull();
    });

    test('pinta pesos con punto de miles y centavos sólo si existen', () => {
        expect(formatearDinero('1500000.00')).toBe('$ 1.500.000');
        expect(formatearDinero('1500000.5')).toBe('$ 1.500.000,50');
        expect(formatearDinero(999)).toBe('$ 999');
        expect(formatearDinero('12345678901234567.89')).toBe('$ 12.345.678.901.234.567,89');
    });

    test('un valor ausente no se pinta como cero', () => {
        expect(formatearDinero(null)).toBe('—');
        expect(formatearDinero(undefined)).toBe('—');
    });

    test('lee lo que se escribe a la colombiana', () => {
        expect(leerDinero('1.500.000')).toBe('1500000');
        expect(leerDinero('$ 1.500.000,50')).toBe('1500000.5');
        expect(leerDinero('2000,')).toBe('2000');
        expect(leerDinero('1,234')).toBeNull();
        expect(leerDinero('-5')).toBeNull();
        expect(leerDinero('')).toBeNull();
    });

    test('ida y vuelta por el formato de edición', () => {
        expect(dineroParaEditar('1500000.50')).toBe('1.500.000,5');
        expect(leerDinero(dineroParaEditar('1500000.50'))).toBe('1500000.5');
        expect(dineroParaEditar(null)).toBe('');
    });
});

describe('fechas', () => {
    test('una fecha de calendario no se corre de día', () => {
        expect(formatearFecha('2026-03-01')).toBe('1 mar 2026');
        expect(formatearFecha('2026-12-31')).toBe('31 dic 2026');
    });

    test('un instante se presenta en hora de Bogotá', () => {
        // 03:00 UTC del 1 de marzo son las 22:00 del 28 de febrero en Bogotá.
        expect(formatearFecha('2026-03-01T03:00:00Z')).toBe('28 feb 2026');
        expect(formatearFechaHora('2026-03-01T03:00:00Z')).toBe('28 feb 2026, 22:00');
    });

    test('valores ilegibles no revientan', () => {
        expect(formatearFecha(null)).toBe('—');
        expect(formatearFechaHora('no-es-fecha')).toBe('—');
    });

    test('hoy es el de Bogotá, no el del contenedor', () => {
        expect(hoyEnBogota(new Date('2026-09-19T04:30:00Z'))).toBe('2026-09-18');
        expect(hoyEnBogota(new Date('2026-09-19T05:30:00Z'))).toBe('2026-09-19');
    });
});
