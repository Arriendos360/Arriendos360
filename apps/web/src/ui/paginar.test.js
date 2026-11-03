import { TAMANO_PAGINA, paginar } from './paginar';

const lista = (cantidad) => Array.from({ length: cantidad }, (_, i) => i + 1);

describe('paginar', () => {
    test('el tamaño de página es 10', () => {
        expect(TAMANO_PAGINA).toBe(10);
    });

    test('sin filas hay una sola página, sin rango', () => {
        expect(paginar([], null)).toEqual({ filas: [], pagina: 1, totalPaginas: 1, desde: 0, hasta: 0, total: 0 });
    });

    test('10 filas caben en una página', () => {
        expect(paginar(lista(10), null)).toMatchObject({ pagina: 1, totalPaginas: 1, desde: 1, hasta: 10, total: 10 });
    });

    test('11 filas son dos páginas', () => {
        const segunda = paginar(lista(11), '2');
        expect(segunda).toMatchObject({ pagina: 2, totalPaginas: 2, desde: 11, hasta: 11, total: 11 });
        expect(segunda.filas).toEqual([11]);
    });

    test('23 filas: la primera, una intermedia y la última', () => {
        expect(paginar(lista(23), '1')).toMatchObject({ desde: 1, hasta: 10, totalPaginas: 3 });
        expect(paginar(lista(23), '2')).toMatchObject({ desde: 11, hasta: 20 });

        const ultima = paginar(lista(23), '3');
        expect(ultima).toMatchObject({ desde: 21, hasta: 23 });
        expect(ultima.filas).toEqual([21, 22, 23]);
    });

    test.each(['abc', '0', '-1', '', null, undefined])('la página inválida %p es la primera', (pedida) => {
        expect(paginar(lista(23), pedida).pagina).toBe(1);
    });

    test('la página con decimales se trunca', () => {
        expect(paginar(lista(23), '1.5').pagina).toBe(1);
        expect(paginar(lista(23), '2.9').pagina).toBe(2);
    });

    test('la página mayor que la última muestra la última', () => {
        expect(paginar(lista(23), '99')).toMatchObject({ pagina: 3, desde: 21, hasta: 23 });
    });

    describe('con 5 por página', () => {
        test('5 filas caben en una página', () => {
            expect(paginar(lista(5), null, 5)).toMatchObject({ totalPaginas: 1, desde: 1, hasta: 5, total: 5 });
        });

        test('6 filas son dos páginas', () => {
            const segunda = paginar(lista(6), '2', 5);
            expect(segunda).toMatchObject({ pagina: 2, totalPaginas: 2, desde: 6, hasta: 6 });
            expect(segunda.filas).toEqual([6]);
        });

        test('12 filas: una intermedia y la última', () => {
            expect(paginar(lista(12), '2', 5)).toMatchObject({ totalPaginas: 3, desde: 6, hasta: 10 });
            expect(paginar(lista(12), '3', 5)).toMatchObject({ desde: 11, hasta: 12 });
        });

        test('la página mayor que la última muestra la última', () => {
            expect(paginar(lista(12), '99', 5)).toMatchObject({ pagina: 3, desde: 11, hasta: 12 });
        });
    });

    test('no altera la lista que recibe', () => {
        const filas = lista(11);
        paginar(filas, '2');
        expect(filas).toHaveLength(11);
    });
});
