import request from 'supertest';

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

  test('La entrada del bus exige la misma credencial', async () => {
    // Va como `router.use` para todo `/interno`, asi que un endpoint nuevo nace
    // protegido. Esta prueba es la que lo comprueba con el mas reciente.
    const respuesta = await request(app).post('/interno/eventos').send({});

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

/*
 * AQUI ESTABAN LAS PRUEBAS DE `POST /interno/inmuebles/:id/estado`.
 *
 * Ese endpoint desaparecio en el paso 5: el estado del inmueble ya no se pide
 * por HTTP, se deduce de `ContratoFormalizado` y `ContratoFinalizado`. Lo que
 * comprobaban —que el estado se mueve, que es idempotente, que valida el
 * catalogo— lo comprueba ahora `eventos.test.ts` sobre el camino que de verdad
 * se despliega.
 */
