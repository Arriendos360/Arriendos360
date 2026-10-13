/** El historial de cambios de un contrato: cómo se anota y quién lo consulta. */

import request from 'supertest';

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
import { Contrato } from '../src/models/Contrato';
import { HistorialContrato } from '../src/models/HistorialContrato';
import { registrarCambios } from '../src/services/historial';

let duenio: ReturnType<typeof propietario>;

const nuevo = async () => {
  const idInquilino = inquilinoDe();
  const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino, { fecha_limite_pago: 5 });
  return { contrato: (await Contrato.findByPk(id)) as Contrato, inquilino: firmarToken({ sub: idInquilino, roles: ['INQUILINO'] }) };
};

const filasDe = (idContrato: string) => HistorialContrato.findAll({ where: { id_contrato: idContrato }, order: [['campo', 'ASC']] });

beforeAll(async () => {
  await prepararEntorno();
  duenio = propietario();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('GET /api/contratos/:id/historial', () => {
  test('el inquilino ve las filas, la más reciente primero', async () => {
    const { contrato, inquilino } = await nuevo();
    const editar = (cuerpo: Record<string, unknown>) =>
      request(app).put(`/api/contratos/${contrato.id_contrato}`).set(...conToken(duenio.token)).send(cuerpo);
    await editar({ fecha_limite_pago: 10 });
    await editar({ info_contrato: 'Otrosí: incluye parqueadero' });

    const respuesta = await request(app)
      .get(`/api/contratos/${contrato.id_contrato}/historial`)
      .set(...conToken(inquilino.token));

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.map((fila: { campo: string }) => fila.campo)).toEqual(['info_contrato', 'fecha_limite_pago']);
    expect(respuesta.body[0]).toMatchObject({ valor_anterior: null, valor_nuevo: 'Otrosí: incluye parqueadero', cambiado_por: duenio.sub });
  });

  test('un usuario ajeno: 404', async () => {
    const { contrato } = await nuevo();

    const respuesta = await request(app)
      .get(`/api/contratos/${contrato.id_contrato}/historial`)
      .set(...conToken(propietario().token));

    expect(respuesta.status).toBe(404);
  });
});

describe('registrarCambios', () => {
  test('una fila por campo que cambia y ninguna por uno enviado igual, con fechas y canon en texto', async () => {
    const { contrato } = await nuevo();

    await sequelize.transaction((t) =>
      registrarCambios(contrato, { canon: 1500000, fin: '2027-06-30', fecha_limite_pago: 10, info_contrato: null }, duenio.sub, t),
    );

    const filas = await filasDe(contrato.id_contrato);
    expect(filas.map((f) => [f.campo, f.valor_anterior, f.valor_nuevo])).toEqual([
      ['fecha_limite_pago', '5', '10'],
      ['fin', '2026-12-31', '2027-06-30'],
    ]);
    expect(filas[0]?.cambiado_por).toBe(duenio.sub);
  });

  test('el canon se compara con sus centavos', async () => {
    const { contrato } = await nuevo();

    await sequelize.transaction((t) => registrarCambios(contrato, { canon: '1600000' }, duenio.sub, t));

    const [fila] = await filasDe(contrato.id_contrato);
    expect([fila?.valor_anterior, fila?.valor_nuevo]).toEqual(['1500000.00', '1600000.00']);
  });

  test('con extra, el motivo y la indemnización', async () => {
    const { contrato } = await nuevo();

    await sequelize.transaction((t) =>
      registrarCambios(contrato, { estado: 'cancelado' }, duenio.sub, t, {
        motivo: 'unilateral_inquilino',
        indemnizacion: 4500000,
        indemnizacion_a_cargo_de: 'INQUILINO',
      }),
    );

    const [fila] = await filasDe(contrato.id_contrato);
    expect(fila).toMatchObject({
      campo: 'estado',
      valor_anterior: 'activo',
      valor_nuevo: 'cancelado',
      motivo: 'unilateral_inquilino',
      indemnizacion: '4500000.00',
      indemnizacion_a_cargo_de: 'INQUILINO',
    });
  });

  test('un rollback de la transacción no deja filas', async () => {
    const { contrato } = await nuevo();

    await expect(
      sequelize.transaction(async (t) => {
        await registrarCambios(contrato, { canon: 2000000 }, duenio.sub, t);
        throw new Error('el cambio falló');
      }),
    ).rejects.toThrow('el cambio falló');

    expect(await filasDe(contrato.id_contrato)).toHaveLength(0);
  });
});
