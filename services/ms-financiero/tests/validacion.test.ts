/**
 * Validación de pagos y cobros: un 400 con `errores` por campo, antes de preguntar
 * la pertenencia, y sin transacción ni cuenta creada. El sobrepago también
 * responde en `monto`.
 */

import request from 'supertest';
import { hoyEnZonaNegocio, sumarDias } from 'arriendos360-shared';

import { CuentaCobro } from '../src/models/CuentaCobro';
import { Transaccion } from '../src/models/Transaccion';
import { app, cerrarEntorno, conToken, crearCuenta, escenario, prepararEntorno } from './utiles/entorno';

let token: string;
let idContrato: string;
let idCuenta: string;

const pagar = (cuerpo: Record<string, unknown>) =>
  request(app).post('/api/pagos').set(...conToken(token)).send({ id_cuenta_cobro: idCuenta, ...cuerpo });

const cobrar = (cuerpo: Record<string, unknown>) =>
  request(app).post('/api/pagos/cuentas-cobro').set(...conToken(token)).send({ id_contrato: idContrato, ...cuerpo });

const campos = (respuesta: request.Response): string[] =>
  (respuesta.body.errores as { campo: string }[]).map((error) => error.campo);

beforeAll(async () => {
  await prepararEntorno();
  const datos = escenario();
  token = datos.propietario.token;
  idContrato = datos.idContrato;
  idCuenta = (await crearCuenta(token, idContrato, { valor: 1000, inicio: '2026-01-01' })).id;
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('POST /api/pagos', () => {
  test.each([
    ['monto', { monto: 'abc' }],
    ['monto', { monto: 0 }],
    ['fecha_pago', { fecha_pago: '2026-13-45' }],
    ['fecha_pago', { fecha_pago: 'ayer' }],
    ['fecha_pago', { fecha_pago: `${sumarDias(hoyEnZonaNegocio(), 1)}T12:00:00-05:00` }],
    ['medio_pago', { medio_pago: 'm'.repeat(51) }],
    ['tipo', { tipo: 'REGALO' }],
  ])('%s inválido: 400 en su campo y nada registrado', async (campo, cambio) => {
    const antes = await Transaccion.count();
    const respuesta = await pagar({ monto: 100, ...cambio });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores).toEqual([{ campo, mensaje: expect.any(String) }]);
    expect(respuesta.body.mensaje).toBe(respuesta.body.errores[0].mensaje);
    expect(await Transaccion.count()).toBe(antes);
  });

  test('varios campos inválidos, en orden', async () => {
    const respuesta = await pagar({ monto: 'abc', fecha_pago: '2026-13-45' });
    expect(campos(respuesta)).toEqual(['monto', 'fecha_pago']);
  });

  test('el sobrepago trae su error en monto', async () => {
    const antes = await Transaccion.count();
    const respuesta = await pagar({ monto: 5000 });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.mensaje).toBe('Monto inválido o superior al saldo');
    expect(respuesta.body.errores).toEqual([{ campo: 'monto', mensaje: 'Monto inválido o superior al saldo' }]);
    expect(await Transaccion.count()).toBe(antes);
  });

  test('hoy a las 23:59 de Bogotá se acepta', async () => {
    const respuesta = await pagar({ monto: '100', fecha_pago: `${hoyEnZonaNegocio()}T23:59:00-05:00` });
    expect(respuesta.status).toBe(201);
  });
});

describe('POST /api/pagos/cuentas-cobro', () => {
  test.each([0, -5, 'abc', 1e10])('valor %s: 400 en valor y ninguna cuenta', async (valor) => {
    const antes = await CuentaCobro.count();
    const respuesta = await cobrar({ valor });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores).toEqual([{ campo: 'valor', mensaje: expect.any(String) }]);
    expect(await CuentaCobro.count()).toBe(antes);
  });
});
