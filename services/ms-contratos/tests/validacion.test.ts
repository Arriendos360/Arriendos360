/**
 * Validación del alta de contratos: un 400 con `errores` por campo, antes de
 * preguntar a ms-inmuebles por la pertenencia, y sin contrato ni evento.
 */

import request from 'supertest';

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
