import { causalesDisponibles, preavisoDe } from '../src/preaviso';
import type { ContratoPreavisable } from '../src/preaviso';

const PLAZOS = { meses: 3, diasRecordatorio: 30 };

const anual: ContratoPreavisable = { inicio: '2026-01-01', fin: '2026-12-31' };

const preaviso = (hoy: string, contrato: ContratoPreavisable = anual) => preavisoDe(contrato, hoy, PLAZOS);

describe('vencimiento vigente', () => {
  test('antes de fin', () => {
    expect(preaviso('2026-08-15')).toMatchObject({ vencimiento: '2026-12-31', prorrogado: false });
  });

  test('el mismo día de fin', () => {
    expect(preaviso('2026-12-31')?.vencimiento).toBe('2026-12-31');
  });

  test('prorrogado, término en meses', () => {
    expect(preaviso('2027-03-01')).toMatchObject({ vencimiento: '2027-12-31', prorrogado: true });
  });

  test('prorrogado dos veces, sin deriva por el recorte del mes', () => {
    const desdeUn31 = { inicio: '2026-01-31', fin: '2026-02-27' };
    expect(preaviso('2026-03-28', desdeUn31)?.vencimiento).toBe('2026-03-30');
    expect(preaviso('2026-04-01', desdeUn31)?.vencimiento).toBe('2026-04-29');
  });

  test('prorrogado, término en días', () => {
    expect(preaviso('2026-09-01', { inicio: '2026-01-15', fin: '2026-07-31' })?.vencimiento).toBe('2027-02-14');
  });

  test('fechas como Date, como las entrega la columna', () => {
    const conDate = { inicio: new Date('2026-01-01T00:00:00Z'), fin: new Date('2026-12-31T00:00:00Z') };
    expect(preaviso('2026-08-15', conDate)?.vencimiento).toBe('2026-12-31');
  });

  test.each([
    ['sin inicio', { inicio: null, fin: '2026-12-31' }],
    ['sin fin', { inicio: '2026-01-01', fin: null }],
  ])('%s: null', (_caso, contrato) => {
    expect(preaviso('2026-08-15', contrato)).toBeNull();
  });
});

describe('fecha límite y ventana', () => {
  test('vencimiento a fin de año', () => {
    expect(preaviso('2026-08-15')).toMatchObject({ fecha_limite: '2026-09-30', recordatorio_desde: '2026-08-31' });
  });

  test('vencimiento a mitad de mes', () => {
    expect(preaviso('2026-09-01', { inicio: '2026-01-15', fin: '2026-07-31' })?.fecha_limite).toBe('2026-11-14');
  });

  test.each([
    ['2026-08-30', false, true],
    ['2026-08-31', true, true],
    ['2026-09-30', true, true],
    ['2026-10-01', false, false],
  ])('hoy %s: en ventana %s, dentro de plazo %s', (hoy, enVentana, dentroDePlazo) => {
    expect(preaviso(hoy)).toMatchObject({ en_ventana: enVentana, dentro_de_plazo: dentroDePlazo });
  });
});

describe('con preaviso registrado', () => {
  const conPreaviso = { ...anual, preaviso_vencimiento: '2026-12-31' };

  test('antes del vencimiento no está vencido', () => {
    expect(preaviso('2026-12-30', conPreaviso)).toMatchObject({ vencimiento: '2026-12-31', vencido: false });
  });

  test('no se prorroga: vencido desde ese día, sin ventana y fuera de plazo', () => {
    for (const hoy of ['2026-12-31', '2027-01-10', '2027-11-01']) {
      expect(preaviso(hoy, conPreaviso)).toMatchObject({
        vencimiento: '2026-12-31',
        vencido: true,
        prorrogado: false,
        en_ventana: false,
        dentro_de_plazo: false,
      });
    }
  });

  test('sin preaviso, pasado fin, no está vencido sino prorrogado', () => {
    expect(preaviso('2027-01-10')).toMatchObject({ vencido: false, prorrogado: true });
  });
});

describe('causales disponibles', () => {
  const CAUSALES = ['ocupacion_propia', 'plena_voluntad'] as const;

  test('plena voluntad con cuatro años exactos', () => {
    expect(causalesDisponibles(CAUSALES, '2023-01-01', '2026-12-31', 4)).toEqual(CAUSALES);
  });

  test('sin plena voluntad con tres años', () => {
    expect(causalesDisponibles(CAUSALES, '2024-01-01', '2026-12-31', 4)).toEqual(['ocupacion_propia']);
  });
});
