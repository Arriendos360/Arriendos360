import { etiquetaDeEstado, filtrarContratos } from './filtros';

const contrato = (id, extra) => ({
    id_contrato: id, id_inmueble: 'apto', estado: 'activo', inicio: '2025-07-01T00:00:00.000Z', fin: '2026-06-30T00:00:00.000Z', ...extra
});

const lista = [
    contrato('a1', { situacion: 'vigente' }),
    contrato('a2', { estado: 'finalizado', inicio: '2025-01-01T00:00:00.000Z', fin: '2025-12-31T00:00:00.000Z' }),
    contrato('c1', { id_inmueble: 'casa', estado: 'cancelado', inicio: '2024-01-01T00:00:00.000Z', fin: '2026-01-01T00:00:00.000Z' }),
    contrato('r1', { id_inmueble: 'casa', situacion: 'renovado' }),
    // Prorrogado: su `fin` registrado pasó, pero sigue vigente hasta el final de la prórroga.
    contrato('r2', {
        situacion: 'renovado', inicio: '2020-01-01T00:00:00.000Z', fin: '2020-12-31T00:00:00.000Z', preaviso: { vencimiento: '2026-12-31' }
    })
];

const ids = (filtros) => filtrarContratos(lista, filtros).map((c) => c.id_contrato);

describe('filtrarContratos', () => {
    test('sin filtros, todos', () => {
        expect(ids({})).toEqual(['a1', 'a2', 'c1', 'r1', 'r2']);
    });

    test('por inmueble', () => {
        expect(ids({ inmueble: 'apto' })).toEqual(['a1', 'a2', 'r2']);
    });

    test('por estado: la situación si la hay, el estado si no', () => {
        expect(etiquetaDeEstado(lista[3])).toBe('renovado');
        expect(etiquetaDeEstado(lista[2])).toBe('cancelado');
        expect(ids({ estado: 'renovado' })).toEqual(['r1', 'r2']);
        expect(ids({ estado: 'cancelado' })).toEqual(['c1']);
    });

    test('periodo: el que cruza sí, el que terminó antes no, el que toca un extremo sí', () => {
        expect(ids({ desde: '2026-01-01', hasta: '2026-12-31' })).toEqual(['a1', 'c1', 'r1', 'r2']);
    });

    test('sólo «Desde»: los que terminan ese día o después', () => {
        expect(ids({ desde: '2026-01-02' })).toEqual(['a1', 'r1', 'r2']);
    });

    test('un renovado sale hasta el vencimiento de su prórroga, no hasta su fin registrado', () => {
        expect(ids({ desde: '2026-08-01', hasta: '2026-12-31' })).toContain('r2');
        expect(ids({ desde: '2027-01-01' })).not.toContain('r2');
    });

    test('combinados: inmueble y estado', () => {
        expect(ids({ inmueble: 'apto', estado: 'finalizado' })).toEqual(['a2']);
    });
});
