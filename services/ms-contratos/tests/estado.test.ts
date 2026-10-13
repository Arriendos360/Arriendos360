/**
 * El estado de un contrato: finalizar sólo lo que no se renovó, cancelar lo que termina antes de
 * tiempo, y la situación con que se presenta un contrato activo.
 */

import request from 'supertest';
import { hoyEnZonaNegocio, sumarDias } from 'arriendos360-shared';

import {
  app,
  cancelarContrato,
  cerrarEntorno,
  conToken,
  crearContrato,
  firmarToken,
  inmuebleDe,
  inmueblesFalso,
  inquilinoDe,
  prepararEntorno,
  propietario,
  sequelize,
} from './utiles/entorno';
import { TABLA_SALIDA, crearPublicadorDeSalida } from '../src/eventos';
import { Contrato } from '../src/models/Contrato';
import { HistorialContrato } from '../src/models/HistorialContrato';

const hoy = hoyEnZonaNegocio();
const VIGENTE = { inicio: sumarDias(hoy, -30), fin: sumarDias(hoy, 300) };
const PRORROGADO = { inicio: sumarDias(hoy, -400), fin: sumarDias(hoy, -35) };

let duenio: ReturnType<typeof propietario>;

/** Un contrato del dueño, con su inmueble y el token de su inquilino. */
const nuevo = async (fechas: Record<string, unknown> = VIGENTE) => {
  const idInmueble = inmuebleDe(duenio.sub);
  const idInquilino = inquilinoDe();
  const { id } = await crearContrato(duenio.token, idInmueble, idInquilino, { canon: 1500000, ...fechas });
  return { id, idInmueble, inquilino: firmarToken({ sub: idInquilino, roles: ['INQUILINO'] }) };
};

/** Registra el preaviso directamente, con el vencimiento dado. */
const conPreaviso = (id: string, vencimiento: string) =>
  Contrato.update(
    { preaviso_enviado_en: new Date('2026-01-01T15:00:00Z'), preaviso_enviado_por: duenio.sub, preaviso_vencimiento: vencimiento, preaviso_causal: 'compraventa' },
    { where: { id_contrato: id } },
  );

const finalizar = (id: string, token = duenio.token) =>
  request(app).put(`/api/contratos/${id}/finalizar`).set(...conToken(token));

const cancelar = (id: string, cuerpo: Record<string, unknown>, token = duenio.token) =>
  request(app).put(`/api/contratos/${id}/cancelar`).set(...conToken(token)).send(cuerpo);

const estadoDe = async (id: string) => (await Contrato.findByPk(id))?.estado;

const finalizadosDe = async (id: string): Promise<number> => {
  const [filas] = await sequelize.query(
    `SELECT 1 FROM ${TABLA_SALIDA} WHERE tipo = 'ContratoFinalizado' AND payload->>'id_contrato' = :id`,
    { replacements: { id } },
  );
  return filas.length;
};

const entregarEventos = () => crearPublicadorDeSalida({ esperaBaseMs: 0, registrar: () => {} }).ciclo();

beforeAll(async () => {
  await prepararEntorno();
  duenio = propietario();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('Finalizar', () => {
  test('con el preaviso vencido: 200, fila de estado y el inmueble queda disponible', async () => {
    const { id, idInmueble } = await nuevo(PRORROGADO);
    await conPreaviso(id, PRORROGADO.fin);

    const respuesta = await finalizar(id);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.contrato.estado).toBe('finalizado');
    const filas = await HistorialContrato.findAll({ where: { id_contrato: id } });
    expect(filas.map((f) => [f.campo, f.valor_anterior, f.valor_nuevo, f.motivo])).toEqual([['estado', 'activo', 'finalizado', null]]);

    await entregarEventos();
    expect(inmueblesFalso().inmuebles.get(idInmueble)?.estado).toBe('disponible');
  });

  test.each([
    ['vigente', VIGENTE],
    ['renovado', PRORROGADO],
  ])('sin preaviso (%s): 409 que remite a cancelar, y sigue activo', async (_situacion, fechas) => {
    const { id } = await nuevo(fechas);

    const respuesta = await finalizar(id);

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.mensaje).toContain('cancél');
    expect(await estadoDe(id)).toBe('activo');
  });

  test('ya terminado: 409 y ningún evento nuevo', async () => {
    const { id } = await nuevo();
    await cancelarContrato(duenio.token, id);

    expect((await finalizar(id)).status).toBe(409);
    expect(await finalizadosDe(id)).toBe(1);
  });
});

describe('Cancelar', () => {
  test('por mutuo acuerdo: 200 y queda cancelado', async () => {
    const { id } = await nuevo();

    const respuesta = await cancelar(id, { motivo: 'mutuo_acuerdo', indemnizacion: 0 });

    expect(respuesta.status).toBe(200);
    expect(await estadoDe(id)).toBe('cancelado');
  });

  test('con una indemnización pactada: la fila guarda motivo, valor y responsable, y el inmueble se libera', async () => {
    const { id, idInmueble } = await nuevo();

    const respuesta = await cancelar(id, {
      motivo: 'unilateral_inquilino',
      indemnizacion: 2000000,
      indemnizacion_a_cargo_de: 'INQUILINO',
    });

    expect(respuesta.status).toBe(200);
    const [fila] = await HistorialContrato.findAll({ where: { id_contrato: id } });
    expect(fila).toMatchObject({
      campo: 'estado',
      valor_anterior: 'activo',
      valor_nuevo: 'cancelado',
      motivo: 'unilateral_inquilino',
      indemnizacion: '2000000.00',
      indemnizacion_a_cargo_de: 'INQUILINO',
      cambiado_por: duenio.sub,
    });

    await entregarEventos();
    expect(inmueblesFalso().inmuebles.get(idInmueble)?.estado).toBe('disponible');
  });

  test.each([
    ['sin motivo', { indemnizacion: 0 }, ['motivo']],
    ['con indemnización negativa', { motivo: 'mutuo_acuerdo', indemnizacion: -1 }, ['indemnizacion']],
    ['con indemnización y sin responsable', { motivo: 'mutuo_acuerdo', indemnizacion: 100 }, ['indemnizacion_a_cargo_de']],
    ['unilateral del arrendador en el término inicial', { motivo: 'unilateral_propietario', indemnizacion: 0 }, ['motivo']],
  ])('%s: 400 y sigue activo', async (_caso, cuerpo, campos) => {
    const { id } = await nuevo();

    const respuesta = await cancelar(id, cuerpo);

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores.map((error: { campo: string }) => error.campo)).toEqual(campos);
    expect(await estadoDe(id)).toBe('activo');
  });

  test('unilateral del arrendador en la prórroga: 200', async () => {
    const { id } = await nuevo(PRORROGADO);

    const cuerpo = { motivo: 'unilateral_propietario', indemnizacion: 4500000, indemnizacion_a_cargo_de: 'PROPIETARIO' };
    expect((await cancelar(id, cuerpo)).status).toBe(200);
  });

  test('un contrato no activo: 409', async () => {
    const { id } = await nuevo();
    await cancelarContrato(duenio.token, id);

    expect((await cancelar(id, { motivo: 'mutuo_acuerdo', indemnizacion: 0 })).status).toBe(409);
  });

  test('el inquilino: 403 y el contrato no cambia', async () => {
    const { id, inquilino } = await nuevo();

    expect((await cancelar(id, { motivo: 'mutuo_acuerdo', indemnizacion: 0 }, inquilino.token)).status).toBe(403);
    expect(await estadoDe(id)).toBe('activo');
  });
});

describe('Situación', () => {
  /** Sólo `Date`; los temporizadores siguen siendo reales. */
  const fijarHoy = (fecha: string): void => {
    jest.useFakeTimers({
      now: new Date(`${fecha}T17:00:00Z`),
      advanceTimers: true,
      doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
  };

  /** La `situacion` que ve el propietario el día dado. */
  const situacionEl = async (id: string, fecha: string) => {
    fijarHoy(fecha);
    const token = firmarToken({ sub: duenio.sub, roles: ['PROPIETARIO'] }).token;
    const respuesta = await request(app).get(`/api/contratos/${id}`).set(...conToken(token));
    jest.useRealTimers();
    return respuesta.body.situacion;
  };

  const ANUAL = { inicio: '2026-01-01', fin: '2026-12-31' };

  test('vigente dentro del término, renovado tras él sin preaviso', async () => {
    const { id } = await nuevo(ANUAL);

    expect(await situacionEl(id, '2026-06-01')).toBe('vigente');
    expect(await situacionEl(id, '2027-01-15')).toBe('renovado');
  });

  test('con preaviso: vigente antes del vencimiento y vencido con preaviso desde ese día', async () => {
    const { id } = await nuevo(ANUAL);
    await conPreaviso(id, '2026-12-31');

    expect(await situacionEl(id, '2026-11-01')).toBe('vigente');
    expect(await situacionEl(id, '2026-12-31')).toBe('vencido_con_preaviso');
  });

  test('las dos partes la ven, también en la lista; un contrato cancelado no la lleva', async () => {
    const { id, inquilino } = await nuevo();

    expect((await request(app).get(`/api/contratos/${id}`).set(...conToken(inquilino.token))).body.situacion).toBe('vigente');
    const lista = await request(app).get('/api/contratos').set(...conToken(duenio.token));
    expect(lista.body.find((c: { id_contrato: string }) => c.id_contrato === id).situacion).toBe('vigente');

    await cancelarContrato(duenio.token, id);
    expect((await request(app).get(`/api/contratos/${id}`).set(...conToken(duenio.token))).body).not.toHaveProperty('situacion');
  });
});
