/**
 * Lectura de variables de entorno.
 *
 * Lo que se fija es la regla que costo tres fallos silenciosos: la cadena vacia es
 * ausencia, un entero mal escrito no cae al defecto, y la validacion del arranque
 * nombra todo lo que falta.
 */

import {
  ErrorDeEntorno,
  enteroDeEntorno,
  enteroOpcionalDeEntorno,
  faltantesDeEntorno,
  leerEntorno,
  textoDeEntorno,
  validarEntorno,
} from '../src/entorno';

describe('leerEntorno', () => {
  test('devuelve el valor, sin espacios alrededor', () => {
    expect(leerEntorno('A', { A: '  valor ' })).toBe('valor');
  });

  test.each([
    ['ausente', {}],
    ['vacia, como la pasa Compose', { A: '' }],
    ['solo espacios', { A: '   ' }],
  ])('%s cuenta como ausente', (_caso, entorno) => {
    expect(leerEntorno('A', entorno)).toBeUndefined();
  });

  test('lee process.env si no se le pasa otro', () => {
    process.env['ENTORNO_PRUEBA_LEER'] = 'x';
    expect(leerEntorno('ENTORNO_PRUEBA_LEER')).toBe('x');
    delete process.env['ENTORNO_PRUEBA_LEER'];
  });
});

describe('textoDeEntorno', () => {
  test('la cadena vacia aplica el defecto — lo que `??` no hacia', () => {
    expect(textoDeEntorno('SERVICIO_NOMBRE', 'ms-contratos', { SERVICIO_NOMBRE: '' })).toBe(
      'ms-contratos',
    );
  });

  test('un valor configurado gana al defecto', () => {
    expect(textoDeEntorno('A', 'defecto', { A: 'propio' })).toBe('propio');
  });
});

describe('enteroDeEntorno', () => {
  test('la cadena vacia aplica el defecto, en vez de dar 0', () => {
    // El caso de REVOCADOS_INTERVALO_MS: `Number('' ?? 15000)` era 0, y el refresco un bucle.
    expect(enteroDeEntorno('REVOCADOS_INTERVALO_MS', 15000, { REVOCADOS_INTERVALO_MS: '' })).toBe(
      15000,
    );
  });

  test('un entero configurado gana al defecto', () => {
    expect(enteroDeEntorno('PORT', 3013, { PORT: ' 4000 ' })).toBe(4000);
  });

  test.each(['0', '-5', 'abc', '15s', '1.5'])('"%s" LANZA en vez de caer al defecto', (valor) => {
    expect(() => enteroDeEntorno('A', 10, { A: valor })).toThrow(ErrorDeEntorno);
    expect(() => enteroDeEntorno('A', 10, { A: valor })).toThrow(`A="${valor}"`);
  });

  test('la version opcional devuelve undefined cuando falta', () => {
    expect(enteroOpcionalDeEntorno('A', { A: '' })).toBeUndefined();
    expect(enteroOpcionalDeEntorno('A', { A: '5000' })).toBe(5000);
  });
});

describe('validarEntorno', () => {
  test('no hace nada si estan todas', () => {
    expect(() => validarEntorno('ms-x', ['A', 'B'], { A: '1', B: '2' })).not.toThrow();
  });

  test('nombra TODAS las que faltan, contando las vacias', () => {
    const entorno = { JWT_SECRET: '', DB_PASSWORD: 'x' };

    expect(faltantesDeEntorno(['JWT_SECRET', 'DB_PASSWORD', 'SERVICIO_JWT_SECRET'], entorno)).toEqual(
      ['JWT_SECRET', 'SERVICIO_JWT_SECRET'],
    );

    try {
      validarEntorno('ms-x', ['JWT_SECRET', 'DB_PASSWORD', 'SERVICIO_JWT_SECRET'], entorno);
      throw new Error('deberia haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeEntorno);
      expect((error as ErrorDeEntorno).variables).toEqual(['JWT_SECRET', 'SERVICIO_JWT_SECRET']);
      expect((error as Error).message).toContain('ms-x');
      expect((error as Error).message).toContain('JWT_SECRET, SERVICIO_JWT_SECRET');
    }
  });

  test('el mensaje no incluye el valor de ninguna variable', () => {
    expect(() => validarEntorno('ms-x', ['FALTA'], { SECRETO: 'no-debe-salir', FALTA: '' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('no-debe-salir') }),
    );
  });
});
