/**
 * La regla del día que no existe en todos los meses.
 *
 * Lógica pura: sin base, sin dobles, sin HTTP. Es la única parte de este paso
 * que se puede probar exhaustivamente, y conviene hacerlo aquí y no a través de
 * la API — un contrato que empieza el 31 de enero sólo enseña el problema
 * catorce meses después.
 *
 * Ver `src/models/fechasContrato.js` para la regla y por qué se recorta en vez
 * de desbordar.
 */

const {
    diaDeCorte,
    diaEnMes,
    diaLimiteDesde,
    esBisiesto,
    fechaEnMes,
    fechaInicioCorteDesde,
    ultimoDiaDelMes
} = require('../src/models/fechasContrato');

// Los meses van 0-11, como en `Date`. Se nombran para que las pruebas se lean.
const ENERO = 0;
const FEBRERO = 1;
const MARZO = 2;
const ABRIL = 3;

describe('Años bisiestos', () => {
    test.each([
        [2024, true, 'divisible por 4'],
        [2026, false, 'no divisible por 4'],
        [2100, false, 'divisible por 100 pero no por 400'],
        [2000, true, 'divisible por 400']
    ])('%i → %s (%s)', (anio, esperado) => {
        expect(esBisiesto(anio)).toBe(esperado);
    });

    test('febrero tiene 29 días en bisiesto y 28 en el resto', () => {
        expect(ultimoDiaDelMes(2024, FEBRERO)).toBe(29);
        expect(ultimoDiaDelMes(2026, FEBRERO)).toBe(28);
    });
});

describe('El día se recorta al último del mes cuando no existe', () => {
    // Los tres días conflictivos del enunciado, contra el mes que los rompe.
    test.each([
        // día, año, mes, esperado, por qué
        [29, 2026, FEBRERO, 28, 'febrero común no llega a 29'],
        [29, 2024, FEBRERO, 29, 'febrero bisiesto sí llega a 29'],
        [30, 2026, FEBRERO, 28, 'ningún febrero llega a 30'],
        [30, 2024, FEBRERO, 29, 'ni siquiera el bisiesto'],
        [31, 2026, FEBRERO, 28, 'el caso del enunciado'],
        [31, 2024, FEBRERO, 29, 'el mismo, en bisiesto'],
        [31, 2026, ABRIL, 30, 'abril tiene 30'],
        [31, 2026, ENERO, 31, 'enero sí tiene 31: no se toca'],
        [15, 2026, FEBRERO, 15, 'un día que existe en todos los meses no se toca'],
        [1, 2026, FEBRERO, 1, 'el primero tampoco']
    ])('día %i en %i-%i → %i (%s)', (dia, anio, mes, esperado) => {
        expect(diaEnMes(anio, mes, dia)).toBe(esperado);
    });

    test('`fechaEnMes` NO se desborda al mes siguiente', () => {
        // Es la razón de existir de la función. `new Date(2026, 1, 31)` devuelve
        // el 3 de marzo sin fallar ni avisar, y con ello el cobro de febrero
        // caía en marzo junto al de marzo: dos en un mes y ninguno en el otro.
        expect(new Date(2026, FEBRERO, 31).getMonth()).toBe(MARZO); // el defecto

        const resuelta = fechaEnMes(2026, FEBRERO, 31);
        expect(resuelta.getMonth()).toBe(FEBRERO);
        expect(resuelta.getDate()).toBe(28);
    });

    test('en bisiesto, el 31 de febrero es el 29', () => {
        const resuelta = fechaEnMes(2024, FEBRERO, 31);
        expect(resuelta.getMonth()).toBe(FEBRERO);
        expect(resuelta.getDate()).toBe(29);
    });
});

describe('Derivación desde el inicio del contrato', () => {
    test('la fecha de corte es la del inicio, como `YYYY-MM-DD`', () => {
        expect(fechaInicioCorteDesde('2026-03-31')).toBe('2026-03-31');
    });

    test.each([
        ['2026-01-29', 29],
        ['2026-01-30', 30],
        ['2026-01-31', 31],
        ['2024-02-29', 29],
        ['2026-06-05', 5]
    ])('%s → día límite %i', (inicio, esperado) => {
        expect(diaLimiteDesde(inicio)).toBe(esperado);
    });

    test('el día se lee en UTC, no en hora local', () => {
        // El formulario manda "2026-03-31" y JavaScript lo interpreta como
        // medianoche UTC. En Bogotá (UTC-5) eso son las 19:00 del 30, así que
        // `.getDate()` devolvería 30 y el contrato quedaría con un día límite
        // que el usuario nunca escribió.
        const comoLoGuardaSequelize = new Date('2026-03-31T00:00:00.000Z');

        expect(diaLimiteDesde(comoLoGuardaSequelize)).toBe(31);
        expect(fechaInicioCorteDesde(comoLoGuardaSequelize)).toBe('2026-03-31');
    });

    test('una fecha inválida devuelve null en vez de NaN', () => {
        // Para que el llamante decida. Un `NaN` en la columna sería un 500 con
        // un error de PostgreSQL dentro.
        expect(diaLimiteDesde('no soy una fecha')).toBeNull();
        expect(fechaInicioCorteDesde(null)).toBeNull();
        expect(fechaInicioCorteDesde('')).toBeNull();
    });
});

describe('Lectura del día de corte ya almacenado', () => {
    test('lee el día del texto que devuelve una columna DATEONLY', () => {
        // Sequelize devuelve `DATEONLY` como 'YYYY-MM-DD'. Se corta la cadena a
        // propósito: `new Date('2026-03-31').getDate()` volvería a meter la zona
        // horaria por la puerta de atrás.
        expect(diaDeCorte('2026-03-31')).toBe(31);
        expect(diaDeCorte('2026-02-01')).toBe(1);
    });

    test('sin fecha, null', () => {
        expect(diaDeCorte(null)).toBeNull();
    });
});
