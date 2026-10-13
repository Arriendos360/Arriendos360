/**
 * El motor recuerda el preaviso de no renovar a las dos partes, una vez por vencimiento. Un
 * contrato del 2026-01-01 al 2026-12-31 tiene fecha límite el 2026-09-30 y la ventana del
 * recordatorio abierta desde el 2026-08-31.
 */

import crypto from 'crypto';

import { procesarPreavisos } from '../src/services/motor';
import {
  cerrarEntorno,
  contratoEnElDoble,
  eventosDeSalida,
  inmuebleDe,
  prepararEntorno,
  propietario,
} from './utiles/entorno';

/** El recordatorio depende del día: se fija la fecha. Sólo `Date`; los temporizadores siguen siendo reales. */
const fijarHoy = (fecha: string): void => {
  jest.useFakeTimers({
    now: new Date(`${fecha}T17:00:00Z`),
    advanceTimers: true,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
};

const recordatoriosDe = async (idContrato: string) =>
  (await eventosDeSalida('PreavisoProximo')).filter((fila) => fila.payload['id_contrato'] === idContrato);

const contrato = (extra: Record<string, unknown> = {}, idInmueble = inmuebleDe(propietario().sub)): string =>
  contratoEnElDoble({
    id_inmueble: idInmueble,
    id_inquilino: crypto.randomUUID(),
    inicio: '2026-01-01T00:00:00.000Z',
    fin: '2026-12-31T00:00:00.000Z',
    fecha_inicio_corte: '2026-01-01',
    ...extra,
  });

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  jest.useRealTimers();
  await cerrarEntorno();
});

describe('Recordatorio del preaviso', () => {
  test('al abrirse la ventana sale una vez, aunque el motor corra dos veces', async () => {
    fijarHoy('2026-08-31');
    const duenio = propietario();
    const idInquilino = crypto.randomUUID();
    const id = contrato({ id_inquilino: idInquilino }, inmuebleDe(duenio.sub));

    expect((await procesarPreavisos()).fallos).toEqual([]);
    fijarHoy('2026-09-01');
    await procesarPreavisos();

    const recordatorios = await recordatoriosDe(id);
    expect(recordatorios).toHaveLength(1);
    expect(recordatorios[0]?.payload).toEqual({
      id_contrato: id,
      id_inquilino: idInquilino,
      id_propietario: duenio.sub,
      direccion_inmueble: 'Calle 123 #45-67',
      vencimiento: '2026-12-31',
      fecha_limite: '2026-09-30',
    });
  });

  test('sale si la primera corrida cae a mitad de la ventana', async () => {
    fijarHoy('2026-09-10');
    const id = contrato();

    await procesarPreavisos();

    expect(await recordatoriosDe(id)).toHaveLength(1);
  });

  test('no sale antes de la ventana ni después de la fecha límite', async () => {
    const id = contrato();

    fijarHoy('2026-08-30');
    await procesarPreavisos();
    fijarHoy('2026-10-01');
    await procesarPreavisos();

    expect(await recordatoriosDe(id)).toHaveLength(0);
  });

  test('no sale con el preaviso enviado', async () => {
    fijarHoy('2026-09-10');
    const id = contrato({ preaviso_enviado_en: '2026-09-02T15:00:00.000Z', preaviso_vencimiento: '2026-12-31' });

    await procesarPreavisos();

    expect(await recordatoriosDe(id)).toHaveLength(0);
  });

  test('no sale sin inmueble con propietario', async () => {
    fijarHoy('2026-09-10');
    const id = contrato({}, crypto.randomUUID());

    await procesarPreavisos();

    expect(await recordatoriosDe(id)).toHaveLength(0);
  });

  test('sin preaviso, sale otro para el vencimiento de la prórroga', async () => {
    const id = contrato();

    fijarHoy('2026-09-10');
    await procesarPreavisos();
    fijarHoy('2027-09-10');
    await procesarPreavisos();

    expect((await recordatoriosDe(id)).map((fila) => fila.payload['vencimiento'])).toEqual(['2026-12-31', '2027-12-31']);
  });

  test('un contrato vencido con preaviso que sigue activo no recuerda el periodo siguiente', async () => {
    fijarHoy('2027-09-10');
    const id = contrato({ preaviso_enviado_en: '2026-09-02T15:00:00.000Z', preaviso_vencimiento: '2026-12-31' });

    await procesarPreavisos();

    expect(await recordatoriosDe(id)).toHaveLength(0);
  });
});
