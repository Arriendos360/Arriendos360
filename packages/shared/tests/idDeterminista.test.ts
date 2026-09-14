/**
 * Identificador de evento determinista.
 *
 * Lo que se fija: el mismo hecho da siempre el mismo `id_evento`, hechos distintos
 * dan identificadores distintos, y el resultado es un UUID valido para la columna.
 */

import {
  TIPO_CUENTA_COBRO_EN_MORA,
  TIPO_CUENTA_COBRO_POR_VENCER,
  crearSobre,
  esSobreEvento,
  idDeEventoDeterminista,
} from '../src/eventos';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('idDeEventoDeterminista', () => {
  test('el mismo hecho da el mismo identificador', () => {
    expect(idDeEventoDeterminista(TIPO_CUENTA_COBRO_POR_VENCER, 'cuenta-1')).toBe(
      idDeEventoDeterminista(TIPO_CUENTA_COBRO_POR_VENCER, 'cuenta-1'),
    );
  });

  test('otra cuenta u otro tipo dan otro identificador', () => {
    const base = idDeEventoDeterminista(TIPO_CUENTA_COBRO_POR_VENCER, 'cuenta-1');

    expect(idDeEventoDeterminista(TIPO_CUENTA_COBRO_POR_VENCER, 'cuenta-2')).not.toBe(base);
    expect(idDeEventoDeterminista(TIPO_CUENTA_COBRO_EN_MORA, 'cuenta-1')).not.toBe(base);
  });

  test('es un UUID version 5 valido, y un sobre con el pasa la validacion', () => {
    const id = idDeEventoDeterminista(TIPO_CUENTA_COBRO_POR_VENCER, 'cuenta-1');
    expect(id).toMatch(UUID_V5);

    const sobre = crearSobre(
      TIPO_CUENTA_COBRO_POR_VENCER,
      {
        id_cuenta_cobro: 'cuenta-1',
        id_contrato: 'contrato-1',
        id_inquilino: 'inquilino-1',
        id_propietario: 'propietario-1',
        valor: 1000,
        inicio: '2026-09-01',
        fin: '2026-09-30',
        entra_en_mora_el: '2026-09-07',
        direccion_inmueble: 'Calle 1',
      },
      { id_evento: id },
    );
    expect(esSobreEvento(sobre)).toBe(true);
  });
});
