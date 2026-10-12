import {
  MAXIMO_INTEGER,
  TOPE_NUMERIC_10_2,
  TOPE_NUMERIC_12_2,
  celular,
  cedula,
  decimalPositivo,
  email,
  entero,
  fechaCalendario,
  fechaNoFutura,
  nombrePersona,
} from '../src/validacion/reglas';
import type { Regla } from '../src/validacion/reglas';

const valor = <T>(regla: Regla<T>, entrada: unknown): T | undefined => {
  const resultado = regla(entrada, 'El campo');
  return 'valor' in resultado ? resultado.valor : undefined;
};

const falla = <T>(regla: Regla<T>, entrada: unknown): boolean => 'error' in regla(entrada, 'El campo');

describe('datos de los incidentes', () => {
  test.each(['Juan123', '1468498', '4642684', '12-31'])('nombre %s se rechaza', (dato) => {
    expect(falla(nombrePersona(100), dato)).toBe(true);
  });

  test.each(['jnkjbn3kj2b3jh234b2j', 'dasnsjdoasjdoaj', 'adada'])('documento %s se rechaza', (dato) => {
    expect(falla(cedula, dato)).toBe(true);
  });

  test.each(['97wqqewqeqeq', 'n2jk4b24jh2b34j2'])('celular %s se rechaza', (dato) => {
    expect(falla(celular, dato)).toBe(true);
  });
});

describe('nombrePersona', () => {
  test('normaliza espacios', () => {
    expect(valor(nombrePersona(100), '  María   José ')).toBe('María José');
  });

  test.each(["O'Neill", 'O’Neill', 'Zoë', 'Ana-María', 'Bjørn'])('acepta %s', (dato) => {
    expect(falla(nombrePersona(100), dato)).toBe(false);
  });

  test('NFC: una e con diéresis combinada cuenta como letra', () => {
    expect(valor(nombrePersona(100), 'Zoë')).toBe('Zoë');
  });

  test.each(['A', 'a'.repeat(101), '--', "'Ana", 'Ana-'])('rechaza %s', (dato) => {
    expect(falla(nombrePersona(100), dato)).toBe(true);
  });
});

describe('cedula', () => {
  test.each(['1.020.304', '12345', '12345678901', '123 456'])('rechaza %s', (dato) => {
    expect(falla(cedula, dato)).toBe(true);
  });

  test('acepta y recorta', () => {
    expect(valor(cedula, ' 1020304050 ')).toBe('1020304050');
  });
});

describe('celular', () => {
  test('normaliza el formato', () => {
    expect(valor(celular, '+57 (300) 123-4567')).toBe('3001234567');
  });

  test.each(['6012345678', '300123456', '57 3001234567', '300+1234567'])('rechaza %s', (dato) => {
    expect(falla(celular, dato)).toBe(true);
  });
});

describe('email', () => {
  test('recorta sin tocar mayúsculas', () => {
    expect(valor(email, ' Ana@Correo.com ')).toBe('Ana@Correo.com');
  });

  test.each(['ana.correo.com', 'ana@correo', 'a b@c.co', 'a@@c.co', `${'a'.repeat(140)}@correo.com`])(
    'rechaza %s',
    (dato) => {
      expect(falla(email, dato)).toBe(true);
    },
  );
});

describe('fechaCalendario', () => {
  test.each(['2026-02-30', '2026-13-45', 'ayer', '2026-1-5', '2026-01-01T25:00:00Z'])('rechaza %s', (dato) => {
    expect(falla(fechaCalendario, dato)).toBe(true);
  });

  test.each(['2028-02-29', '2026-10-12T17:00:00Z', '2026-10-12T17:00:00.000Z', '2026-10-12T08:00:00-05:00'])(
    'acepta %s',
    (dato) => {
      expect(falla(fechaCalendario, dato)).toBe(false);
    },
  );
});

describe('fechaNoFutura', () => {
  const hoy = '2026-10-12';

  test('hoy a las 12:00 de Bogotá pasa', () => {
    expect(falla(fechaNoFutura(hoy), '2026-10-12T17:00:00Z')).toBe(false);
  });

  test('hoy a las 23:59 de Bogotá pasa, aunque en UTC ya sea mañana', () => {
    expect(falla(fechaNoFutura(hoy), '2026-10-13T04:59:00Z')).toBe(false);
  });

  test('mañana no pasa', () => {
    expect(falla(fechaNoFutura(hoy), '2026-10-13T17:00:00Z')).toBe(true);
    expect(falla(fechaNoFutura(hoy), '2026-10-13')).toBe(true);
  });

  test('un día suelto es ese día, no medianoche UTC', () => {
    expect(falla(fechaNoFutura(hoy), '2026-10-12')).toBe(false);
  });
});

describe('números y topes de columna', () => {
  test('decimal: texto o número, mayor que cero', () => {
    expect(valor(decimalPositivo(TOPE_NUMERIC_12_2), '1500000.50')).toBe(1500000.5);
    expect(valor(decimalPositivo(TOPE_NUMERIC_12_2), 75.5)).toBe(75.5);
    for (const dato of [0, -5, 'abc', '1,5', '-1', Number.NaN, Infinity, 0.001]) {
      expect(falla(decimalPositivo(TOPE_NUMERIC_12_2), dato)).toBe(true);
    }
  });

  test('NUMERIC(12,2) llega hasta 10^10 sin incluirlo, también al redondear', () => {
    expect(falla(decimalPositivo(TOPE_NUMERIC_12_2), 9999999999.99)).toBe(false);
    expect(falla(decimalPositivo(TOPE_NUMERIC_12_2), 1e10)).toBe(true);
    expect(falla(decimalPositivo(TOPE_NUMERIC_12_2), '9999999999.999')).toBe(true);
  });

  test('NUMERIC(10,2) llega hasta 10^8 sin incluirlo', () => {
    expect(falla(decimalPositivo(TOPE_NUMERIC_10_2), 99999999.99)).toBe(false);
    expect(falla(decimalPositivo(TOPE_NUMERIC_10_2), 1e8)).toBe(true);
  });

  test('entero: texto o número, en su rango', () => {
    expect(valor(entero(1, 6), '4')).toBe(4);
    for (const dato of [0, 7, 1.5, '-1', 'tres']) {
      expect(falla(entero(1, 6), dato)).toBe(true);
    }
  });

  test('INTEGER llega hasta 2^31 - 1', () => {
    expect(valor(entero(0, MAXIMO_INTEGER), MAXIMO_INTEGER)).toBe(MAXIMO_INTEGER);
    expect(entero(0, MAXIMO_INTEGER)(MAXIMO_INTEGER + 1, 'El campo')).toEqual({ error: 'El campo es demasiado grande' });
  });
});
