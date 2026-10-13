/**
 * Ajuste anual del canon por IPC. El contrato empezó el 2024-03-10: su ajuste de 2025 usa el
 * IPC de 2024 (5,20 %) y su ventana sigue abierta mientras no se aplique, sea cual sea el día en
 * que corran las pruebas.
 */

import request from 'supertest';
import { TIPO_CANON_AJUSTADO, hoyEnZonaNegocio, sumarDias } from 'arriendos360-shared';

import {
  app,
  cerrarEntorno,
  conToken,
  crearContrato,
  firmarToken,
  inmuebleDe,
  inquilinoDe,
  prepararEntorno,
  propietario,
  sequelize,
} from './utiles/entorno';
import { TABLA_SALIDA, suscriptoresDe } from '../src/eventos';
import { Contrato } from '../src/models/Contrato';

let duenio: ReturnType<typeof propietario>;

const CON_VENTANA_ABIERTA = { inicio: '2024-03-10', fin: '2025-03-09', canon: 1500000 };

const consultar = (token: string, id: string) =>
  request(app).get(`/api/contratos/${id}`).set(...conToken(token));

const editar = (id: string, cuerpo: Record<string, unknown>) =>
  request(app).put(`/api/contratos/${id}`).set(...conToken(duenio.token)).send(cuerpo);

const avisosDe = async (id: string): Promise<Array<Record<string, unknown>>> => {
  const [filas] = await sequelize.query(
    `SELECT payload FROM ${TABLA_SALIDA} WHERE tipo = 'CanonAjustado' AND payload->>'id_contrato' = :id`,
    { replacements: { id } },
  );
  return (filas as Array<{ payload: Record<string, unknown> }>).map((fila) => fila.payload);
};

const nuevo = async (extra: Record<string, unknown> = CON_VENTANA_ABIERTA): Promise<string> =>
  (await crearContrato(duenio.token, inmuebleDe(duenio.sub), inquilinoDe(), extra)).id;

beforeAll(async () => {
  await prepararEntorno();
  duenio = propietario();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('ajuste_canon en la consulta', () => {
  test('el propietario lo recibe, con la fecha, el IPC y el sugerido', async () => {
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), inquilinoDe(), CON_VENTANA_ABIERTA);

    const respuesta = await consultar(duenio.token, id);

    expect(respuesta.body.ajuste_canon).toMatchObject({
      fecha_ajuste: '2025-03-10',
      ventana_desde: '2025-02-10',
      en_ventana: true,
      anio_ipc: 2024,
      ipc: 5.2,
      canon_sugerido: 1578000,
    });
  });

  test('también en la lista', async () => {
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), inquilinoDe(), CON_VENTANA_ABIERTA);

    const lista = await request(app).get('/api/contratos').set(...conToken(duenio.token));
    const suyo = lista.body.find((contrato: { id_contrato: string }) => contrato.id_contrato === id);

    expect(suyo.ajuste_canon.canon_sugerido).toBe(1578000);
  });

  test('el inquilino no lo recibe', async () => {
    const idInquilino = inquilinoDe();
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino, CON_VENTANA_ABIERTA);
    const inquilino = firmarToken({ sub: idInquilino, roles: ['INQUILINO'] });

    const respuesta = await consultar(inquilino.token, id);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).not.toHaveProperty('ajuste_canon');
  });

  test('un contrato finalizado no lo trae', async () => {
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), inquilinoDe(), CON_VENTANA_ABIERTA);
    await request(app).put(`/api/contratos/${id}/finalizar`).set(...conToken(duenio.token));

    const respuesta = await consultar(duenio.token, id);

    expect(respuesta.body.estado).toBe('finalizado');
    expect(respuesta.body).not.toHaveProperty('ajuste_canon');
  });
});

describe('aplicar el ajuste editando el canon', () => {
  test('dentro del tope: guarda desde cuándo rige, avisa al inquilino y el siguiente ajuste es 12 meses después de eso', async () => {
    const id = await nuevo();

    const respuesta = await editar(id, { canon: 1578000 });

    expect(respuesta.status).toBe(200);
    // Aplicado tarde (el ajuste era el 2025-03-10): rige desde el próximo corte sin facturar.
    const rige = String(respuesta.body.rige_desde);
    expect((await Contrato.findByPk(id))?.fecha_ultimo_ajuste).toBe(rige);
    expect((await consultar(duenio.token, id)).body.ajuste_canon.fecha_ajuste).toBe(
      `${Number(rige.slice(0, 4)) + 1}${rige.slice(4)}`,
    );

    const avisos = await avisosDe(id);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      id_propietario: duenio.sub,
      direccion_inmueble: 'Calle 123 #45-67',
      canon_anterior: 1500000,
      canon_nuevo: 1578000,
      ipc: 5.2,
      anio_ipc: 2024,
      rige_desde: respuesta.body.rige_desde,
    });
    expect(String(respuesta.body.rige_desde) > hoyEnZonaNegocio()).toBe(true);
  });

  test('por encima del tope: 400 en canon, sin cambio y sin aviso', async () => {
    const id = await nuevo();

    const respuesta = await editar(id, { canon: 1600000 });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores).toEqual([{ campo: 'canon', mensaje: expect.stringContaining('1.578.000') }]);
    expect(Number((await Contrato.findByPk(id))?.canon)).toBe(1500000);
    expect(await avisosDe(id)).toHaveLength(0);
  });

  test('por debajo del sugerido también es el ajuste', async () => {
    const id = await nuevo();

    const respuesta = await editar(id, { canon: 1550000 });

    expect(respuesta.status).toBe(200);
    expect((await Contrato.findByPk(id))?.fecha_ultimo_ajuste).toBe(respuesta.body.rige_desde);
    expect(await avisosDe(id)).toHaveLength(1);
  });

  test('fuera de la ventana el canon cambia como antes, sin fecha ni aviso', async () => {
    const hoy = hoyEnZonaNegocio();
    const id = await nuevo({ inicio: sumarDias(hoy, -10), fin: sumarDias(hoy, 355), canon: 1500000 });

    expect((await editar(id, { canon: 2000000 })).status).toBe(200);
    expect((await Contrato.findByPk(id))?.fecha_ultimo_ajuste).toBeNull();
    expect(await avisosDe(id)).toHaveLength(0);
  });

  test('cambiar sólo el deudor dentro de la ventana no es un ajuste', async () => {
    const id = await nuevo();

    await editar(id, { canon: 1500000, nombre_deudor_solidario: 'Ana Fiadora', documento_deudor_solidario: '10203040' });

    expect((await Contrato.findByPk(id))?.fecha_ultimo_ajuste).toBeNull();
    expect(await avisosDe(id)).toHaveLength(0);
  });

  test('la fecha del último ajuste no se acepta del cliente', async () => {
    const id = await nuevo();

    await editar(id, { fecha_ultimo_ajuste: '2030-01-01', info_contrato: 'Sin cambios de canon' });

    expect((await Contrato.findByPk(id))?.fecha_ultimo_ajuste).toBeNull();
  });
});

describe('entrega de CanonAjustado', () => {
  test('va a ms-notificaciones', () => {
    const antes = process.env['MS_NOTIFICACIONES_URL'];
    process.env['MS_NOTIFICACIONES_URL'] = 'http://ms-notificaciones:3015';

    expect(suscriptoresDe(TIPO_CANON_AJUSTADO)).toEqual([
      { nombre: 'ms-notificaciones', url: 'http://ms-notificaciones:3015' },
    ]);

    process.env['MS_NOTIFICACIONES_URL'] = antes;
  });
});
