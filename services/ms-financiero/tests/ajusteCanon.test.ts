/**
 * El motor avisa al propietario cuando se abre la ventana de ajuste del canon, una vez por
 * ajuste. Hoy es el 2025-04-02: un contrato que empezó el 2024-03-10 tiene abierta desde el
 * 2025-02-10 la ventana de su ajuste del 2025-03-10, con el IPC de 2024.
 */

import crypto from 'crypto';
import { hoyEnZonaNegocio, sumarDias } from 'arriendos360-shared';

import { procesarAjustes } from '../src/services/motor';
import {
  cerrarEntorno,
  contratoEnElDoble,
  eventosDeSalida,
  inmuebleDe,
  prepararEntorno,
  propietario,
} from './utiles/entorno';

/** El ajuste depende del día: se fija la fecha. Sólo `Date`; los temporizadores siguen siendo reales. */
const fijarHoy = (fecha: string): void => {
  jest.useFakeTimers({
    now: new Date(`${fecha}T17:00:00Z`),
    advanceTimers: true,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
};

const avisosDe = async (idContrato: string) =>
  (await eventosDeSalida('AjusteCanonProximo')).filter((fila) => fila.payload['id_contrato'] === idContrato);

const contrato = (extra: Record<string, unknown>, idInmueble = inmuebleDe(propietario().sub)): string =>
  contratoEnElDoble({
    id_inmueble: idInmueble,
    id_inquilino: crypto.randomUUID(),
    canon: 1500000,
    inicio: '2024-03-10T00:00:00.000Z',
    fecha_inicio_corte: '2024-03-10',
    ...extra,
  });

beforeAll(async () => {
  await prepararEntorno();
});

beforeEach(() => fijarHoy('2025-04-02'));

afterAll(async () => {
  jest.useRealTimers();
  await cerrarEntorno();
});

describe('Aviso de ajuste de canon', () => {
  test('avisa al propietario con la ventana abierta, aunque se haya abierto otro día', async () => {
    const duenio = propietario();
    const id = contrato({}, inmuebleDe(duenio.sub));

    const resultado = await procesarAjustes();

    expect(resultado.fallos).toEqual([]);
    const avisos = await avisosDe(id);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.payload).toEqual({
      id_contrato: id,
      id_propietario: duenio.sub,
      direccion_inmueble: 'Calle 123 #45-67',
      canon_actual: 1500000,
      canon_sugerido: 1578000,
      ipc: 5.2,
      anio_ipc: 2024,
      fecha_ajuste: '2025-03-10',
    });
  });

  test('otra ejecución no repite el aviso', async () => {
    const id = contrato({});

    await procesarAjustes();
    await procesarAjustes();

    expect(await avisosDe(id)).toHaveLength(1);
  });

  test('no avisa antes de la ventana', async () => {
    const hoy = hoyEnZonaNegocio();
    const id = contrato({ inicio: sumarDias(hoy, -10), fecha_inicio_corte: sumarDias(hoy, -10) });

    await procesarAjustes();

    expect(await avisosDe(id)).toHaveLength(0);
  });

  test('no avisa sin el IPC del año', async () => {
    // Su ajuste rige en 2019 y necesitaría el IPC de 2018, que no está en el catálogo.
    fijarHoy('2019-12-01');
    const id = contrato({ inicio: '2018-12-10T00:00:00.000Z', fecha_inicio_corte: '2018-12-10' });

    await procesarAjustes();

    expect(await avisosDe(id)).toHaveLength(0);
  });

  test('no avisa sin inmueble con propietario', async () => {
    const id = contrato({}, crypto.randomUUID());

    await procesarAjustes();

    expect(await avisosDe(id)).toHaveLength(0);
  });

  test('después de un ajuste avisa el siguiente, no el ya aplicado', async () => {
    fijarHoy('2026-03-01');
    const id = contrato({ fecha_ultimo_ajuste: '2025-03-10' });

    await procesarAjustes();

    const avisos = await avisosDe(id);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.payload).toMatchObject({ fecha_ajuste: '2026-03-10', anio_ipc: 2025, ipc: 5.1 });
  });
});
