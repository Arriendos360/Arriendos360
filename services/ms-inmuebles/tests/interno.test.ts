import request from 'supertest';
import crypto from 'crypto';

import {
  app,
  cerrarBase,
  conServicio,
  conToken,
  crearInmueble,
  propietario,
  recrearBase,
} from './utiles/entorno';

const dueno = propietario();
const otro = propietario();

let idA: string;
let idB: string;
let idDeOtro: string;

beforeAll(async () => {
  await recrearBase();

  idA = (await crearInmueble(dueno.token, { direccion: 'Calle A' })).id;
  idB = (await crearInmueble(dueno.token, { direccion: 'Calle B' })).id;
  idDeOtro = (await crearInmueble(otro.token, { direccion: 'Calle C' })).id;
});

afterAll(async () => {
  await cerrarBase();
});

describe('Credencial de servicio', () => {
  test('Sin credencial, /interno responde 401', async () => {
    // El puerto está publicado al host en desarrollo: que la petición venga de
    // la red interna no la hace confiable (regla dura 7).
    const respuesta = await request(app).get(`/interno/inmuebles?propietario=${dueno.sub}`);

    expect(respuesta.statusCode).toBe(401);
  });

  test('Un token de USUARIO no sirve como credencial de servicio', async () => {
    // El esquema es `Servicio`, no `Bearer`, y la clave es otra. Si compartieran
    // secreto, el token de cualquier inquilino abriría /interno.
    const respuesta = await request(app)
      .get(`/interno/inmuebles?propietario=${dueno.sub}`)
      .set(...conToken(dueno.token));

    expect(respuesta.statusCode).toBe(401);
  });

  test('Con credencial válida pasa', async () => {
    const respuesta = await request(app)
      .get(`/interno/inmuebles?propietario=${dueno.sub}`)
      .set(...conServicio());

    expect(respuesta.statusCode).toBe(200);
  });

  test('El endpoint de estado exige la misma credencial', async () => {
    const respuesta = await request(app)
      .post(`/interno/inmuebles/${idA}/estado`)
      .send({ estado: 'arrendado' });

    expect(respuesta.statusCode).toBe(401);
  });
});

describe('GET /interno/inmuebles', () => {
  test('Por propietario devuelve solo los suyos', async () => {
    const respuesta = await request(app)
      .get(`/interno/inmuebles?propietario=${dueno.sub}`)
      .set(...conServicio());

    const ids = respuesta.body.inmuebles.map((i: { id_inmueble: string }) => i.id_inmueble);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([idA, idB]));
    expect(ids).not.toContain(idDeOtro);
  });

  test('Por ids devuelve el lote pedido, en una sola llamada', async () => {
    // En lote a propósito: de uno en uno sería el N+1 de siempre, pero con
    // latencia de red en vez de con un JOIN.
    const respuesta = await request(app)
      .get(`/interno/inmuebles?ids=${idA},${idDeOtro}`)
      .set(...conServicio());

    const ids = respuesta.body.inmuebles.map((i: { id_inmueble: string }) => i.id_inmueble);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([idA, idDeOtro]));
  });

  test('Los ids con forma inválida se descartan sin romper la consulta', async () => {
    const respuesta = await request(app)
      .get(`/interno/inmuebles?ids=${idA},no-soy-uuid,`)
      .set(...conServicio());

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.inmuebles).toHaveLength(1);
  });

  test('Una lista entera de basura devuelve vacío, no 500', async () => {
    const respuesta = await request(app)
      .get('/interno/inmuebles?ids=a,b,c')
      .set(...conServicio());

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.inmuebles).toEqual([]);
  });

  test('Sin filtro NO vuelca la tabla entera', async () => {
    const respuesta = await request(app).get('/interno/inmuebles').set(...conServicio());

    expect(respuesta.statusCode).toBe(400);
  });
});

describe('POST /interno/inmuebles/:id/estado', () => {
  test('Mueve el estado a arrendado', async () => {
    const respuesta = await request(app)
      .post(`/interno/inmuebles/${idA}/estado`)
      .set(...conServicio())
      .send({ estado: 'arrendado', solicitado_por: dueno.sub });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.inmueble.estado).toBe('arrendado');
  });

  test('La auditoría registra a la persona, no al servicio', async () => {
    // `iss` sería "gateway", que no es un UUID: escribirlo en la columna daría
    // un 500, y aunque cupiera perdería el dato que importa auditar.
    const consulta = await request(app)
      .get(`/api/inmuebles/${idA}`)
      .set(...conToken(dueno.token));

    expect(consulta.body.actualizado_por).toBe(dueno.sub);
  });

  test('Y de vuelta a disponible', async () => {
    const respuesta = await request(app)
      .post(`/interno/inmuebles/${idA}/estado`)
      .set(...conServicio())
      .send({ estado: 'disponible', solicitado_por: dueno.sub });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.inmueble.estado).toBe('disponible');
  });

  test('Es idempotente: repetirlo no falla', async () => {
    // Lo que hace seguro el reintento del gateway cuando la primera llamada
    // falló después de aplicarse. Ver docs/adr/0011.
    const primera = await request(app)
      .post(`/interno/inmuebles/${idB}/estado`)
      .set(...conServicio())
      .send({ estado: 'arrendado', solicitado_por: dueno.sub });

    const segunda = await request(app)
      .post(`/interno/inmuebles/${idB}/estado`)
      .set(...conServicio())
      .send({ estado: 'arrendado', solicitado_por: dueno.sub });

    expect(primera.statusCode).toBe(200);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.body.inmueble.estado).toBe('arrendado');
  });

  test('Un estado fuera del catálogo devuelve 400', async () => {
    const respuesta = await request(app)
      .post(`/interno/inmuebles/${idA}/estado`)
      .set(...conServicio())
      .send({ estado: 'en_obra', solicitado_por: dueno.sub });

    expect(respuesta.statusCode).toBe(400);
  });

  test('Un inmueble inexistente devuelve 404', async () => {
    const respuesta = await request(app)
      .post(`/interno/inmuebles/${crypto.randomUUID()}/estado`)
      .set(...conServicio())
      .send({ estado: 'arrendado', solicitado_por: dueno.sub });

    expect(respuesta.statusCode).toBe(404);
  });

  test('Un id con forma inválida devuelve 404, no 500', async () => {
    const respuesta = await request(app)
      .post('/interno/inmuebles/no-soy-uuid/estado')
      .set(...conServicio())
      .send({ estado: 'arrendado', solicitado_por: dueno.sub });

    expect(respuesta.statusCode).toBe(404);
  });

  test('Sin solicitado_por sigue funcionando, con el sistema como autor', async () => {
    // El llamante debería mandarlo siempre, pero un endpoint interno no puede
    // quedarse a medias por un campo de auditoría.
    const respuesta = await request(app)
      .post(`/interno/inmuebles/${idB}/estado`)
      .set(...conServicio())
      .send({ estado: 'disponible' });

    expect(respuesta.statusCode).toBe(200);
  });
});
