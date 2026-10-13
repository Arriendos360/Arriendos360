import { ajusteDeCanon } from '../src/ajusteCanon';
import type { ContratoAjustable } from '../src/ajusteCanon';

const IPC = { 2024: 5.2 };

const contrato = (cambios: Partial<ContratoAjustable> = {}): ContratoAjustable => ({
  inicio: '2024-03-10',
  fecha_inicio_corte: '2024-03-10',
  fecha_ultimo_ajuste: null,
  canon: '1500000.00',
  ...cambios,
});

const ajuste = (cambios: Partial<ContratoAjustable>, hoy = '2025-02-20') => ajusteDeCanon(contrato(cambios), hoy, IPC);

describe('fecha de ajuste', () => {
  test('corte el mismo día del inicio', () => {
    expect(ajuste({})?.fecha_ajuste).toBe('2025-03-10');
  });

  test('corte en un día distinto: el primer corte después del aniversario', () => {
    expect(ajuste({ inicio: '2024-03-20', fecha_inicio_corte: '2024-04-01' })?.fecha_ajuste).toBe('2025-04-01');
  });

  test('inicio un 29 de febrero', () => {
    expect(ajuste({ inicio: '2024-02-29', fecha_inicio_corte: '2024-02-29' })?.fecha_ajuste).toBe('2025-02-28');
  });

  test('inicio un 31 con corte el 31', () => {
    expect(ajuste({ inicio: '2024-01-31', fecha_inicio_corte: '2024-01-31' })?.fecha_ajuste).toBe('2025-01-31');
  });

  test('después de un ajuste se cuenta desde él', () => {
    expect(ajuste({ fecha_ultimo_ajuste: '2025-03-10' })?.fecha_ajuste).toBe('2026-03-10');
  });

  test('inicio como Date, como lo entrega la columna', () => {
    expect(ajuste({ inicio: new Date('2024-03-10T00:00:00Z') })?.fecha_ajuste).toBe('2025-03-10');
  });

  test('un contrato activo pasado su fin está prorrogado y también se ajusta', () => {
    const prorrogado = { ...contrato(), fin: '2025-03-09' };
    expect(ajusteDeCanon(prorrogado, '2025-02-20', IPC)?.fecha_ajuste).toBe('2025-03-10');
  });

  test('sin día de corte no hay ajuste', () => {
    expect(ajuste({ fecha_inicio_corte: null })).toBeNull();
  });
});

describe('canon sugerido', () => {
  test('con el IPC del año anterior a la fecha de ajuste', () => {
    expect(ajuste({})).toMatchObject({ anio_ipc: 2024, ipc: 5.2, canon_sugerido: 1578000 });
  });

  test('redondeado hacia abajo al peso', () => {
    expect(ajuste({ canon: 1234567 })?.canon_sugerido).toBe(1298764);
  });

  test('sin IPC del año: fecha sí, sugerido y ventana no', () => {
    expect(ajuste({ fecha_ultimo_ajuste: '2025-03-10' }, '2026-02-20')).toMatchObject({
      fecha_ajuste: '2026-03-10',
      anio_ipc: 2025,
      ipc: null,
      canon_sugerido: null,
      en_ventana: false,
    });
  });
});

describe('ventana de ajuste', () => {
  test('se abre en el corte anterior', () => {
    expect(ajuste({}, '2025-02-20')).toMatchObject({ ventana_desde: '2025-02-10', en_ventana: true });
  });

  test('antes de abrirse', () => {
    expect(ajuste({}, '2025-02-05')?.en_ventana).toBe(false);
  });

  test('sigue abierta si el ajuste no se aplicó a tiempo', () => {
    expect(ajuste({}, '2025-04-02')).toMatchObject({ fecha_ajuste: '2025-03-10', en_ventana: true });
  });
});

describe('rige desde', () => {
  test('aplicado con tiempo: desde la fecha de ajuste', () => {
    expect(ajuste({}, '2025-03-05')?.rige_desde).toBe('2025-03-10');
  });

  test('aplicado con la cuenta de esa fecha ya generada: desde el corte siguiente', () => {
    expect(ajuste({}, '2025-03-09')?.rige_desde).toBe('2025-04-10');
  });

  test('aplicado tarde: el primer corte que falta por facturar', () => {
    expect(ajuste({}, '2025-05-20')?.rige_desde).toBe('2025-06-10');
  });
});
