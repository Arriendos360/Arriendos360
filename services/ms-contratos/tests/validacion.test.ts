/**
 * Validación del alta de contratos: un 400 con `errores` por campo, antes de
 * preguntar a ms-inmuebles por la pertenencia, y sin contrato ni evento.
 */

import request from 'supertest';
import { hoyEnZonaNegocio } from 'arriendos360-shared';

import {
  app,
  cerrarEntorno,
  conToken,
  contratoValido,
  inmuebleDe,
  inquilinoDe,
  prepararEntorno,
  propietario,
  sequelize,
} from './utiles/entorno';
import { TABLA_SALIDA } from '../src/eventos';
import { Contrato } from '../src/models/Contrato';

let duenio: ReturnType<typeof propietario>;
let idInmueble: string;
let idInquilino: string;

const firmar = (token: string, extra: Record<string, unknown>) =>
  request(app).post('/api/contratos').set(...conToken(token)).send(contratoValido(idInmueble, idInquilino, extra));

const eventos = async (): Promise<number> => {
  const [filas] = await sequelize.query(`SELECT id_evento FROM ${TABLA_SALIDA}`);
  return filas.length;
};

const sobreDe = async (idContrato: string): Promise<{ version: number; payload: Record<string, unknown> } | undefined> => {
  const [filas] = await sequelize.query(
    `SELECT version, payload FROM ${TABLA_SALIDA} WHERE payload->>'id_contrato' = :idContrato`,
    { replacements: { idContrato } },
  );
  return (filas as Array<{ version: number; payload: Record<string, unknown> }>)[0];
};

const campos = (respuesta: request.Response): string[] =>
  (respuesta.body.errores as { campo: string }[]).map((error) => error.campo);

beforeAll(async () => {
  await prepararEntorno();
  duenio = propietario();
  idInmueble = inmuebleDe(duenio.sub);
  idInquilino = inquilinoDe();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('POST /api/contratos', () => {
  test.each([
    ['inicio', { inicio: '2026-02-30' }],
    ['fin', { fin: '2025-01-01' }],
    ['canon', { canon: 'abc' }],
    ['canon', { canon: 1e10 }],
    ['fecha_limite_pago', { fecha_limite_pago: 32 }],
    ['fecha_inicio_corte', { fecha_inicio_corte: '2026-02-30' }],
    ['nombre_deudor_solidario', { nombre_deudor_solidario: '12-31', documento_deudor_solidario: '79456321' }],
    ['documento_deudor_solidario', { nombre_deudor_solidario: 'Ana Fiadora', documento_deudor_solidario: 'adada' }],
    ['documento_deudor_solidario', { nombre_deudor_solidario: 'Ana Fiadora' }],
    ['nombre_deudor_solidario', { documento_deudor_solidario: '10203040' }],
  ])('%s inválido: 400 en su campo, sin contrato ni evento', async (campo, cambio) => {
    const [contratos, enSalida] = [await Contrato.count(), await eventos()];
    const respuesta = await firmar(duenio.token, cambio);

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores).toEqual([{ campo, mensaje: expect.any(String) }]);
    expect(await Contrato.count()).toBe(contratos);
    expect(await eventos()).toBe(enSalida);
  });

  test('errores de condiciones y de deudor juntos, mensaje igual al primero', async () => {
    const respuesta = await firmar(duenio.token, {
      fin: '2025-01-01',
      nombre_deudor_solidario: 'Ana Fiadora',
      documento_deudor_solidario: 'adada',
    });

    expect(campos(respuesta)).toEqual(['fin', 'documento_deudor_solidario']);
    expect(respuesta.body.mensaje).toBe('La fecha de fin debe ser posterior a la de inicio');
  });

  test('un cuerpo inválido sobre un inmueble ajeno da 400, no 403', async () => {
    const respuesta = await firmar(propietario().token, { canon: 'abc' });

    expect(respuesta.status).toBe(400);
    expect(campos(respuesta)).toEqual(['canon']);
  });

  test('guarda el deudor normalizado', async () => {
    const respuesta = await firmar(duenio.token, {
      nombre_deudor_solidario: ' Jorge  Enrique Ruiz ',
      documento_deudor_solidario: '79456321',
      fecha_limite_pago: '5',
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.contrato.nombre_deudor_solidario).toBe('Jorge Enrique Ruiz');
    expect(respuesta.body.contrato.fecha_limite_pago).toBe(5);
  });

  test('sin deudor, o con los dos vacíos, se crea sin deudor', async () => {
    const respuesta = await firmar(duenio.token, { nombre_deudor_solidario: '', documento_deudor_solidario: '' });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.contrato.nombre_deudor_solidario ?? null).toBeNull();
  });
});

describe('POST /api/contratos: un contrato que ya corría', () => {
  const hoy = hoyEnZonaNegocio();
  const inicio = '2020-02-17';
  const antiguo = { inicio, fin: '2021-02-17', canon: 1500000 };
  const mes = hoy.slice(0, 7);
  const firmarAntiguo = (cuerpo: Record<string, unknown>) =>
    request(app)
      .post('/api/contratos')
      .set(...conToken(duenio.token))
      .send({ id_inmueble: inmuebleDe(duenio.sub, 'Antiguo'), id_inquilino: idInquilino, ...cuerpo });

  test('guarda el mes como el inicio de su periodo, la fecha del ajuste, y lo anuncia en el evento', async () => {
    const respuesta = await firmarAntiguo({ ...antiguo, ultimo_periodo_pagado: '2026-08', fecha_ultimo_ajuste: '2026-02-17' });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.contrato.ultimo_periodo_pagado).toBe('2026-08-17');
    expect(respuesta.body.contrato.fecha_ultimo_ajuste).toBe('2026-02-17');

    const guardado = await Contrato.findByPk(respuesta.body.contrato.id_contrato);
    expect(guardado?.ultimo_periodo_pagado).toBe('2026-08-17');

    const sobre = await sobreDe(respuesta.body.contrato.id_contrato);
    expect(sobre?.version).toBe(3);
    expect(sobre?.payload['ultimo_periodo_pagado']).toBe('2026-08-17');
  });

  test('«nunca se ha ajustado» deja la fecha vacía', async () => {
    const respuesta = await firmarAntiguo({ ...antiguo, ultimo_periodo_pagado: mes, nunca_ajustado: true });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.contrato.fecha_ultimo_ajuste).toBeNull();
  });

  test('«no ha pagado ningún mes» guarda el periodo anterior al primero y lo anuncia', async () => {
    const respuesta = await firmarAntiguo({ ...antiguo, nunca_pagado: true, nunca_ajustado: true });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.contrato.ultimo_periodo_pagado).toBe('2020-01-17');
    expect((await sobreDe(respuesta.body.contrato.id_contrato))?.payload['ultimo_periodo_pagado']).toBe('2020-01-17');
  });

  test('un primer corte anterior al inicio: 400', async () => {
    const respuesta = await firmarAntiguo({ ...antiguo, fecha_inicio_corte: '2020-02-16', nunca_pagado: true, nunca_ajustado: true });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body.errores.map((error: { campo: string }) => error.campo)).toEqual(['fecha_inicio_corte']);
  });

  test.each([
    ['sin último mes pagado', { nunca_ajustado: true }, 'ultimo_periodo_pagado'],
    ['mes anterior al inicio', { ultimo_periodo_pagado: '2020-01', nunca_ajustado: true }, 'ultimo_periodo_pagado'],
    ['mes futuro', { ultimo_periodo_pagado: '2099-01', nunca_ajustado: true }, 'ultimo_periodo_pagado'],
    ['sin ajuste ni casilla', { ultimo_periodo_pagado: mes }, 'fecha_ultimo_ajuste'],
    ['ajuste antes del inicio', { ultimo_periodo_pagado: mes, fecha_ultimo_ajuste: '2020-02-16' }, 'fecha_ultimo_ajuste'],
    ['ajuste futuro', { ultimo_periodo_pagado: mes, fecha_ultimo_ajuste: '2099-01-01' }, 'fecha_ultimo_ajuste'],
  ])('%s: 400 y no se crea', async (_caso, cambio, campo) => {
    const antes = await Contrato.count();

    const respuesta = await firmarAntiguo({ ...antiguo, ...cambio });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body.errores.map((error: { campo: string }) => error.campo)).toEqual([campo]);
    expect(await Contrato.count()).toBe(antes);
  });

  test('un contrato reciente no los pide y, si llegan, no los guarda', async () => {
    const respuesta = await firmarAntiguo({
      inicio: hoy,
      fin: '2099-01-01',
      canon: 1500000,
      ultimo_periodo_pagado: mes,
      fecha_ultimo_ajuste: hoy,
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.contrato.ultimo_periodo_pagado).toBeNull();
    expect(respuesta.body.contrato.fecha_ultimo_ajuste).toBeNull();

    const sobre = await sobreDe(respuesta.body.contrato.id_contrato);
    expect(sobre?.payload).not.toHaveProperty('ultimo_periodo_pagado');
  });

  test('editarlo después no se admite', async () => {
    const { body } = await firmarAntiguo({ inicio: hoy, fin: '2099-01-01', canon: 1500000 });

    const respuesta = await request(app)
      .put(`/api/contratos/${body.contrato.id_contrato}`)
      .set(...conToken(duenio.token))
      .send({ ultimo_periodo_pagado: '2026-01' });

    expect(respuesta.statusCode).toBe(400);
  });
});
