/**
 * `siNoDeEntorno`: los interruptores que distinguen entornos.
 *
 * Lo que se fija: solo `si` y `no` valen, la cadena vacia cuenta como ausente, y sin
 * valor por defecto la ausencia lanza en vez de elegir un entorno por omision.
 */

import { ErrorDeEntorno, siNoDeEntorno } from '../src/entorno';

describe('siNoDeEntorno', () => {
  test('«si» y «no», sin importar mayusculas, espacios ni tilde', () => {
    expect(siNoDeEntorno('A', undefined, { A: 'si' })).toBe(true);
    expect(siNoDeEntorno('A', undefined, { A: ' SÍ ' })).toBe(true);
    expect(siNoDeEntorno('A', undefined, { A: 'No' })).toBe(false);
  });

  test.each(['true', '1', 'yes', 'false', '0'])('«%s» LANZA: solo hay una forma de escribirlo', (valor) => {
    expect(() => siNoDeEntorno('A', false, { A: valor })).toThrow(ErrorDeEntorno);
  });

  test('ausente o vacia con valor por defecto: el defecto', () => {
    expect(siNoDeEntorno('A', false, {})).toBe(false);
    expect(siNoDeEntorno('A', true, { A: '' })).toBe(true);
  });

  test('ausente sin valor por defecto: LANZA y nombra la variable', () => {
    expect(() => siNoDeEntorno('MIGRACIONES_AL_ARRANCAR', undefined, { MIGRACIONES_AL_ARRANCAR: '' })).toThrow(
      'MIGRACIONES_AL_ARRANCAR',
    );
  });
});
