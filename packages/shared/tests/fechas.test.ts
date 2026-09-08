/**
 * La regla del día que no existe en todos los meses.
 *
 * Lógica pura: sin base, sin dobles, sin HTTP. Es la única parte de este paso
 * que se puede probar exhaustivamente, y conviene hacerlo aquí y no a través de
 * la API — un contrato que empieza el 31 de enero sólo enseña el problema
 * catorce meses después.
 *
 * ── ESTA SUITE SE MUDO EN EL PASO 6d ─────────────────────────────────────────
 *
 * Vivia en `apps/gateway/tests/fechasContrato.test.js`. La regla subio a
 * `packages/shared` cuando Contratos y Financiero dejaron de vivir en el mismo
 * proceso: los dos la necesitan, y duplicarla habria sido tener dos
 * calendarios. Las pruebas suben con ella, con las mismas afirmaciones y dos
 * secciones nuevas —el periodo y el conteo de dias— que antes estaban repartidas
 * entre las suites del motor financiero.
 *
 * Ver `src/fechas.ts` para la regla y por que se recorta en vez de desbordar.
 */

import {
  diaDeCorte,
  diaEnMes,
  diaLimiteDesde,
  diasEntre,
  esBisiesto,
  fechaEnMes,
  fechaInicioCorteDesde,
  periodoDeCorte,
  ultimoDiaDelMes,
} from '../src/fechas';

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

describe('El periodo de una cuenta de cobro TESELA el calendario', () => {
    // La propiedad que hace correcta la definicion —«fin es la vispera del
    // siguiente corte»— y no la obvia. Cada dia pertenece a un periodo y solo a
    // uno, sin huecos ni solapes, sea cual sea el dia pactado.
    test('con corte el 31, los tres primeros meses encajan sin dejar un dia fuera', () => {
        const enero = periodoDeCorte(31, 2026, ENERO);
        const febrero = periodoDeCorte(31, 2026, FEBRERO);
        const marzo = periodoDeCorte(31, 2026, MARZO);

        expect(enero).toEqual({ inicio: '2026-01-31', fin: '2026-02-27' });
        expect(febrero).toEqual({ inicio: '2026-02-28', fin: '2026-03-30' });
        expect(marzo).toEqual({ inicio: '2026-03-31', fin: '2026-04-29' });

        // Sin huecos: el fin de uno es la vispera del inicio del siguiente.
        expect(diasEntre(enero.fin, febrero.inicio)).toBe(1);
        expect(diasEntre(febrero.fin, marzo.inicio)).toBe(1);
    });

    test('la definicion obvia dejaria tres dias de marzo sin dueño', () => {
        // «inicio mas un mes menos un dia» daria 2026-03-27 para febrero, y los
        // dias 28, 29 y 30 de marzo no serian de nadie. Se comprueba la
        // diferencia para que la decision quede escrita y no se pueda deshacer
        // por descuido.
        const febrero = periodoDeCorte(31, 2026, FEBRERO);
        expect(febrero.fin).toBe('2026-03-30');
        expect(febrero.fin).not.toBe('2026-03-27');
    });

    test('con un dia que existe en todos los meses, los periodos son regulares', () => {
        expect(periodoDeCorte(10, 2026, ENERO)).toEqual({
            inicio: '2026-01-10',
            fin: '2026-02-09'
        });
    });

    test('el cambio de año se resuelve', () => {
        expect(periodoDeCorte(5, 2026, 11)).toEqual({ inicio: '2026-12-05', fin: '2027-01-04' });
    });
});

describe('Conteo de dias de calendario', () => {
    test('cuenta dias, no intervalos de 24 horas', () => {
        // Es lo que permite que «el sexto dia» sea una afirmacion comprobable y
        // no dependa de la hora a la que se pregunte.
        expect(diasEntre('2026-01-01', '2026-01-07')).toBe(6);
        expect(diasEntre('2026-01-07', '2026-01-01')).toBe(-6);
        expect(diasEntre('2026-01-01', '2026-01-01')).toBe(0);
    });

    test('atraviesa meses y años sin sorpresas', () => {
        expect(diasEntre('2026-02-27', '2026-03-01')).toBe(2);
        expect(diasEntre('2024-02-27', '2024-03-01')).toBe(3); // bisiesto
        expect(diasEntre('2026-12-31', '2027-01-01')).toBe(1);
    });
});
