/**
 * Preaviso de no renovar. Hoy es el 2026-09-05: un contrato del 2026-01-01 al 2026-12-31 tiene
 * fecha límite el 2026-09-30 y la ventana del recordatorio abierta desde el 2026-08-31.
 */

import request from 'supertest';

import {
  app,
  cerrarEntorno,
  conToken,
  crearContrato,
  firmarToken,
  identidadFalsa,
  inmuebleDe,
  inquilinoDe,
  prepararEntorno,
  propietario,
} from './utiles/entorno';
import { levantarDobleNotificaciones, type DobleNotificaciones } from './dobles/servicios';
import { crearPublicadorDeSalida } from '../src/eventos';
import { Contrato } from '../src/models/Contrato';
import { textoDelPdf } from './utiles/pdf';

const fijarHoy = (fecha: string): void => {
  jest.useFakeTimers({
    now: new Date(`${fecha}T17:00:00Z`),
    advanceTimers: true,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
};

const EN_VENTANA = { inicio: '2026-01-01', fin: '2026-12-31' };

let duenio: ReturnType<typeof propietario>;
let notificaciones: DobleNotificaciones;

/** Un contrato del dueño con un inquilino nuevo, y el token de ese inquilino. */
const nuevo = async (fechas: Record<string, unknown> = EN_VENTANA) => {
  const idInquilino = inquilinoDe();
  const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino, fechas);
  return { id, inquilino: firmarToken({ sub: idInquilino, roles: ['INQUILINO'] }) };
};

const consultar = (token: string, id: string) => request(app).get(`/api/contratos/${id}`).set(...conToken(token));

const enviar = (token: string, id: string, cuerpo: Record<string, unknown> = {}) =>
  request(app).post(`/api/contratos/${id}/preaviso`).set(...conToken(token)).send(cuerpo);

beforeAll(async () => {
  await prepararEntorno();
  notificaciones = await levantarDobleNotificaciones();
  process.env['MS_NOTIFICACIONES_URL'] = notificaciones.url;
  fijarHoy('2026-09-05');
  duenio = propietario();
  identidadFalsa().usuarios.set(duenio.sub, {
    id: duenio.sub,
    nombres: 'Ana',
    apellidos: 'Propietaria',
    documento: '52111222',
    roles: ['PROPIETARIO'],
  });
});

afterAll(async () => {
  jest.useRealTimers();
  delete process.env['MS_NOTIFICACIONES_URL'];
  await notificaciones.cerrar();
  await cerrarEntorno();
});

describe('preaviso en la consulta', () => {
  test('las dos partes lo ven; sólo el propietario, las causales', async () => {
    const { id, inquilino } = await nuevo();

    const delDuenio = (await consultar(duenio.token, id)).body.preaviso;
    const delInquilino = (await consultar(inquilino.token, id)).body.preaviso;

    const esperado = {
      vencimiento: '2026-12-31',
      fecha_limite: '2026-09-30',
      recordatorio_desde: '2026-08-31',
      en_ventana: true,
      dentro_de_plazo: true,
      prorrogado: false,
      vencido: false,
      enviado: null,
    };
    expect(delDuenio).toMatchObject(esperado);
    expect(delDuenio.causales_disponibles).toEqual(['ocupacion_propia', 'demolicion', 'reparaciones', 'compraventa']);
    expect(delInquilino).toMatchObject(esperado);
    expect(delInquilino).not.toHaveProperty('causales_disponibles');
  });

  test('también en la lista', async () => {
    const { id } = await nuevo();

    const lista = await request(app).get('/api/contratos').set(...conToken(duenio.token));
    const suyo = lista.body.find((contrato: { id_contrato: string }) => contrato.id_contrato === id);

    expect(suyo.preaviso.fecha_limite).toBe('2026-09-30');
  });

  test('un contrato finalizado no lo lleva', async () => {
    const { id } = await nuevo();
    await request(app).put(`/api/contratos/${id}/finalizar`).set(...conToken(duenio.token));

    expect((await consultar(duenio.token, id)).body).not.toHaveProperty('preaviso');
  });

  test('vencido con preaviso: sin prórroga y con la constancia', async () => {
    const { id, inquilino } = await nuevo({ inicio: '2025-07-01', fin: '2026-06-30' });
    await Contrato.update(
      {
        preaviso_enviado_en: new Date('2026-03-01T15:00:00Z'),
        preaviso_enviado_por: inquilino.sub,
        preaviso_vencimiento: '2026-06-30',
      },
      { where: { id_contrato: id } },
    );

    expect((await consultar(duenio.token, id)).body.preaviso).toMatchObject({
      vencimiento: '2026-06-30',
      vencido: true,
      prorrogado: false,
      en_ventana: false,
      dentro_de_plazo: false,
      enviado: { enviado_en: '2026-03-01T15:00:00.000Z', parte: 'INQUILINO', causal: null },
    });
  });
});

describe('enviar el preaviso', () => {
  test('el inquilino dentro de plazo: 201, constancia sin causal aunque la mande, y aviso sin correo', async () => {
    const { id, inquilino } = await nuevo();

    const respuesta = await enviar(inquilino.token, id, { causal: 'compraventa' });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.contrato.preaviso.enviado).toMatchObject({ parte: 'INQUILINO', causal: null });
    const guardado = await Contrato.findByPk(id);
    expect(guardado).toMatchObject({
      preaviso_enviado_por: inquilino.sub,
      preaviso_vencimiento: '2026-12-31',
      preaviso_causal: null,
    });
    expect(guardado?.preaviso_enviado_en?.toISOString()).toMatch(/^2026-09-05T/);

    // `proximo_intento_en` sale del NOW() real de la base, posterior al reloj fijado.
    await crearPublicadorDeSalida({ esperaBaseMs: 0, registrar: () => {}, ahora: () => new Date('9999-12-31') }).ciclo();
    const aviso = notificaciones.eventos.find((e) => e.tipo === 'PreavisoEnviado' && e.payload['id_contrato'] === id);
    expect(aviso?.payload).toEqual({
      id_contrato: id,
      id_inquilino: inquilino.sub,
      id_propietario: duenio.sub,
      parte: 'INQUILINO',
      direccion_inmueble: 'Calle 123 #45-67',
      vencimiento: '2026-12-31',
      causal: null,
      enviado_en: guardado?.preaviso_enviado_en?.toISOString(),
    });
    expect(JSON.stringify(aviso?.payload)).not.toContain('@');
  });

  test('el propietario con una causal disponible: 201 y la constancia la guarda', async () => {
    const { id } = await nuevo();

    const respuesta = await enviar(duenio.token, id, { causal: 'ocupacion_propia' });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.contrato.preaviso.enviado).toMatchObject({ parte: 'PROPIETARIO', causal: 'ocupacion_propia' });
    expect(await Contrato.findByPk(id)).toMatchObject({ preaviso_enviado_por: duenio.sub, preaviso_causal: 'ocupacion_propia' });
  });

  test('plena voluntad con cuatro años al vencimiento de la prórroga', async () => {
    const { id } = await nuevo({ inicio: '2023-01-01', fin: '2023-12-31' });

    expect((await consultar(duenio.token, id)).body.preaviso.causales_disponibles).toContain('plena_voluntad');
    expect((await enviar(duenio.token, id, { causal: 'plena_voluntad' })).status).toBe(201);
    expect((await Contrato.findByPk(id))?.preaviso_vencimiento).toBe('2026-12-31');
  });

  test.each([
    ['sin causal', {}],
    ['con una causal desconocida', { causal: 'capricho' }],
    ['con plena voluntad antes de cuatro años', { causal: 'plena_voluntad' }],
  ])('el propietario %s: 400 en causal', async (_caso, cuerpo) => {
    const { id } = await nuevo();

    const respuesta = await enviar(duenio.token, id, cuerpo);

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores).toEqual([{ campo: 'causal', mensaje: expect.any(String) }]);
    expect((await Contrato.findByPk(id))?.preaviso_enviado_en).toBeNull();
  });

  test('fuera de plazo: 409 con la fecha límite y el vencimiento, sin registrar nada', async () => {
    const { id, inquilino } = await nuevo({ inicio: '2026-01-01', fin: '2026-10-31' });

    const respuesta = await enviar(inquilino.token, id);

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.mensaje).toContain('2026-07-31');
    expect(respuesta.body.mensaje).toContain('2026-10-31');
    expect((await Contrato.findByPk(id))?.preaviso_enviado_en).toBeNull();
  });

  test('repetido: 409 y la constancia no cambia', async () => {
    const { id, inquilino } = await nuevo();
    await enviar(inquilino.token, id);

    const respuesta = await enviar(duenio.token, id, { causal: 'compraventa' });

    expect(respuesta.status).toBe(409);
    expect(await Contrato.findByPk(id)).toMatchObject({ preaviso_enviado_por: inquilino.sub, preaviso_causal: null });
  });

  test('un contrato finalizado: 409', async () => {
    const { id, inquilino } = await nuevo();
    await request(app).put(`/api/contratos/${id}/finalizar`).set(...conToken(duenio.token));

    expect((await enviar(inquilino.token, id)).status).toBe(409);
  });

  test('un usuario ajeno: 404', async () => {
    const { id } = await nuevo();

    expect((await enviar(propietario().token, id, { causal: 'compraventa' })).status).toBe(404);
    expect((await enviar(firmarToken({ roles: ['INQUILINO'] }).token, id)).status).toBe(404);
  });
});

/** Pide la carta con el cuerpo como Buffer. */
const pedirCarta = (id: string, token: string) =>
  request(app)
    .get(`/api/contratos/${id}/preaviso`)
    .set(...conToken(token))
    .buffer(true)
    .parse((res, callback) => {
      const trozos: Buffer[] = [];
      res.on('data', (trozo: Buffer) => trozos.push(trozo));
      res.on('end', () => callback(null, Buffer.concat(trozos)));
    });

const texto = (pdf: Buffer): string => textoDelPdf(pdf).replace(/\s+/g, ' ');

describe('carta del preaviso', () => {
  test('del inquilino: remitente, destinatario, vencimiento, art. 24 y el plazo', async () => {
    const { id, inquilino } = await nuevo();
    await enviar(inquilino.token, id);

    const respuesta = await pedirCarta(id, duenio.token);

    expect(respuesta.status).toBe(200);
    expect(respuesta.header['content-type']).toBe('application/pdf');
    expect(respuesta.header['content-disposition']).toMatch(/^attachment; filename="preaviso-.{8}\.pdf"$/);
    const lectura = texto(respuesta.body as Buffer);
    expect(lectura).toContain('Inq Uilino');
    expect(lectura).toContain('Ana Propietaria');
    expect(lectura).toContain('52111222');
    expect(lectura).toContain('31 de diciembre de 2026');
    expect(lectura).toContain('artículo 24');
    expect(lectura).toContain('3 meses');
    expect(lectura).not.toContain('Invoco la causal');
  });

  test('del propietario: art. 22 y la causal con su etiqueta', async () => {
    const { id, inquilino } = await nuevo();
    await enviar(duenio.token, id, { causal: 'compraventa' });

    const respuesta = await pedirCarta(id, inquilino.token);

    expect(respuesta.status).toBe(200);
    const lectura = texto(respuesta.body as Buffer);
    expect(lectura).toContain('artículo 22');
    expect(lectura).toContain('contrato de compraventa');
    expect(lectura).toContain('3 meses');
  });

  test('sin preaviso registrado: 404', async () => {
    const { id } = await nuevo();

    const respuesta = await request(app).get(`/api/contratos/${id}/preaviso`).set(...conToken(duenio.token));

    expect(respuesta.status).toBe(404);
  });

  test('con ms-identidad caído: 502 y ningún PDF', async () => {
    const { id, inquilino } = await nuevo();
    await enviar(inquilino.token, id);

    identidadFalsa().caer();
    const respuesta = await request(app).get(`/api/contratos/${id}/preaviso`).set(...conToken(duenio.token));
    identidadFalsa().levantar();

    expect(respuesta.status).toBe(502);
    expect(respuesta.header['content-type']).toMatch(/json/);
  });
});
