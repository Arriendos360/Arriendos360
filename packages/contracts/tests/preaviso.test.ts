import {
  ANIOS_PLENA_VOLUNTAD,
  CAUSALES_PREAVISO_ARRENDADOR,
  DIAS_RECORDATORIO_PREAVISO,
  FUNDAMENTO_PREAVISO,
  MESES_PREAVISO_TERMINACION,
} from '../src/contratos';

describe('plazos del preaviso', () => {
  test.each([MESES_PREAVISO_TERMINACION, DIAS_RECORDATORIO_PREAVISO, ANIOS_PLENA_VOLUNTAD])(
    '%s: entero positivo',
    (plazo) => {
      expect(Number.isInteger(plazo)).toBe(true);
      expect(plazo).toBeGreaterThan(0);
    },
  );
});

describe('causales del arrendador', () => {
  test.each(Object.entries(CAUSALES_PREAVISO_ARRENDADOR))('%s: con etiqueta legal', (_causal, etiqueta) => {
    expect(etiqueta).toMatch(/\(literal [a-d]\)$/);
  });

  // `packages/shared/src/preaviso.ts` la nombra sin importar el catálogo.
  test('plena voluntad está en el catálogo', () => {
    expect(CAUSALES_PREAVISO_ARRENDADOR).toHaveProperty('plena_voluntad');
  });

  test('cada parte tiene su fundamento legal', () => {
    expect(FUNDAMENTO_PREAVISO.PROPIETARIO).toContain('artículo 22');
    expect(FUNDAMENTO_PREAVISO.INQUILINO).toContain('artículo 24');
  });
});
