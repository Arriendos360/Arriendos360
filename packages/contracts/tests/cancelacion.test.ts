import { CAMPOS_CONTRATO_EDITABLES, MOTIVOS_CANCELACION } from '../src/contratos';
import { validarCancelacion } from '../src/validacion/cuerpos';

const campos = (errores: { campo: string }[]): string[] => errores.map((error) => error.campo);

const vigente = { situacion: 'vigente' };

describe('MOTIVOS_CANCELACION', () => {
  test('sólo las unilaterales sugieren indemnización, de 3 cánones', () => {
    const sugeridos = Object.fromEntries(Object.entries(MOTIVOS_CANCELACION).map(([clave, m]) => [clave, m.canones_sugeridos]));
    expect(sugeridos).toEqual({
      mutuo_acuerdo: 0,
      incumplimiento_inquilino: 0,
      incumplimiento_propietario: 0,
      unilateral_inquilino: 3,
      unilateral_propietario: 3,
    });
  });

  test('sólo la unilateral del arrendador exige la prórroga', () => {
    const enProrroga = Object.entries(MOTIVOS_CANCELACION).filter(([, m]) => m.solo_en_prorroga).map(([clave]) => clave);
    expect(enProrroga).toEqual(['unilateral_propietario']);
  });

  test('ni el estado, ni las partes, ni el corte se editan', () => {
    for (const campo of ['estado', 'id_inmueble', 'id_inquilino', 'inicio', 'fecha_inicio_corte']) {
      expect(CAMPOS_CONTRATO_EDITABLES).not.toContain(campo);
    }
  });
});

describe('validarCancelacion', () => {
  test('mutuo acuerdo sin indemnización', () => {
    expect(validarCancelacion({ motivo: 'mutuo_acuerdo', indemnizacion: 0 }, vigente)).toEqual({
      datos: { motivo: 'mutuo_acuerdo', indemnizacion: 0, indemnizacion_a_cargo_de: undefined },
      errores: [],
    });
  });

  test('una indemnización pactada distinta de la sugerida', () => {
    const { datos, errores } = validarCancelacion(
      { motivo: 'unilateral_inquilino', indemnizacion: '2000000', indemnizacion_a_cargo_de: 'INQUILINO' },
      vigente,
    );
    expect(errores).toEqual([]);
    expect(datos).toMatchObject({ indemnizacion: 2000000, indemnizacion_a_cargo_de: 'INQUILINO' });
  });

  test.each([
    ['ausente', {}],
    ['desconocido', { motivo: 'capricho' }],
  ])('motivo %s', (_caso, cuerpo) => {
    expect(campos(validarCancelacion({ indemnizacion: 0, ...cuerpo }, vigente).errores)).toEqual(['motivo']);
  });

  test('la unilateral del arrendador sólo en prórroga', () => {
    const cuerpo = { motivo: 'unilateral_propietario', indemnizacion: 0 };
    expect(campos(validarCancelacion(cuerpo, vigente).errores)).toEqual(['motivo']);
    expect(validarCancelacion(cuerpo, { situacion: 'renovado' }).errores).toEqual([]);
  });

  test.each([-1, 'mucho', '1,5'])('indemnización %p', (indemnizacion) => {
    expect(campos(validarCancelacion({ motivo: 'mutuo_acuerdo', indemnizacion }, vigente).errores)).toEqual([
      'indemnizacion',
    ]);
  });

  test('mayor que 0 exige quién la paga, y sólo una de las dos partes', () => {
    const cuerpo = { motivo: 'mutuo_acuerdo', indemnizacion: 100 };
    expect(campos(validarCancelacion(cuerpo, vigente).errores)).toEqual(['indemnizacion_a_cargo_de']);
    expect(campos(validarCancelacion({ ...cuerpo, indemnizacion_a_cargo_de: 'GATEWAY' }, vigente).errores)).toEqual([
      'indemnizacion_a_cargo_de',
    ]);
  });

  test('todos los errores juntos', () => {
    expect(campos(validarCancelacion({ motivo: 'unilateral_propietario', indemnizacion: -5 }, vigente).errores)).toEqual([
      'motivo',
      'indemnizacion',
    ]);
    expect(campos(validarCancelacion({}, vigente).errores)).toEqual(['motivo', 'indemnizacion']);
  });
});
