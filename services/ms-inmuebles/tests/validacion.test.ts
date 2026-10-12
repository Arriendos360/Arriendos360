/**
 * Validación del alta de inmuebles: un 400 con `errores` por campo, todos a la vez
 * y sin inmueble creado. Ningún dato del cliente llega a la base como un 500.
 */

import request from 'supertest';

import { app, cerrarBase, conToken, inmuebleValido, propietario, recrearBase } from './utiles/entorno';
import { Inmueble } from '../src/models/Inmueble';

const dueno = propietario();

const crear = (cuerpo: Record<string, unknown>) =>
  request(app).post('/api/inmuebles').set(...conToken(dueno.token)).send(cuerpo);

const campos = (respuesta: request.Response): string[] =>
  (respuesta.body.errores as { campo: string }[]).map((error) => error.campo);

beforeAll(async () => {
  await recrearBase();
});

afterAll(async () => {
  await cerrarBase();
});

describe('POST /api/inmuebles', () => {
  test.each([
    ['alias', { alias: '' }],
    ['alias', { alias: 'a'.repeat(101) }],
    ['direccion', { direccion: 'd'.repeat(256) }],
    ['tipo', { tipo: 'castillo' }],
    ['barrio', { barrio: 'b'.repeat(101) }],
    ['departamento', { departamento: 'd'.repeat(101) }],
    ['ciudad', { ciudad: 'c'.repeat(101) }],
    ['area_m2', { area_m2: 0 }],
    ['area_m2', { area_m2: 'grande' }],
    ['area_m2', { area_m2: 1e8 }],
    ['estrato', { estrato: 0 }],
    ['estrato', { estrato: 7 }],
    ['habitaciones', { habitaciones: -1 }],
    ['habitaciones', { habitaciones: 1.5 }],
    ['banos', { banos: -1 }],
    ['banos', { banos: 1.5 }],
    ['parqueaderos', { parqueaderos: -1 }],
    ['parqueaderos', { parqueaderos: 1.5 }],
    ['deposito', { deposito: -1 }],
    ['deposito', { deposito: 1.5 }],
  ])('%s inválido: 400 en su campo y nada creado', async (campo, cambio) => {
    const antes = await Inmueble.count();
    const respuesta = await crear(inmuebleValido(cambio));

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.errores).toEqual([{ campo, mensaje: expect.any(String) }]);
    expect(respuesta.body.mensaje).toBe(respuesta.body.errores[0].mensaje);
    expect(await Inmueble.count()).toBe(antes);
  });

  test('alias, dirección y tipo inválidos juntos', async () => {
    const respuesta = await crear({ tipo: 'castillo' });

    expect(respuesta.status).toBe(400);
    expect(campos(respuesta)).toEqual(['alias', 'direccion', 'tipo']);
    expect(respuesta.body.errores[2].mensaje).toContain('apartamento');
  });

  test('varios campos de la ficha, en el orden del formulario', async () => {
    const respuesta = await crear(inmuebleValido({ alias: '', estrato: 7, habitaciones: -1 }));

    expect(campos(respuesta)).toEqual(['alias', 'estrato', 'habitaciones']);
    expect(respuesta.body.mensaje).toBe('El alias es obligatorio');
  });

  test('la ficha en texto se guarda como número', async () => {
    const respuesta = await crear(inmuebleValido({ estrato: '4', area_m2: '75.5', habitaciones: '3' }));

    expect(respuesta.status).toBe(201);
    const inmueble = await Inmueble.findByPk(respuesta.body.inmueble.id_inmueble);
    expect(inmueble?.estrato).toBe(4);
    expect(Number(inmueble?.area_m2)).toBe(75.5);
    expect(inmueble?.habitaciones).toBe(3);
  });

  test('sin ficha física se crea igual que antes', async () => {
    const respuesta = await crear(inmuebleValido());

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.inmueble.parqueaderos).toBe(0);
  });
});
