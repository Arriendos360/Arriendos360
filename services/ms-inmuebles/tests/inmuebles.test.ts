import request from 'supertest';
import crypto from 'crypto';

import {
  app,
  cerrarBase,
  conServicio,
  conToken,
  crearInmueble,
  inmuebleValido,
  inquilino,
  propietario,
  recrearBase,
} from './utiles/entorno';

const dueno = propietario();
const ajeno = propietario();
const arrendatario = inquilino();

beforeAll(async () => {
  await recrearBase();
});

afterAll(async () => {
  await cerrarBase();
});

describe('Alta de inmuebles', () => {
  test('Un propietario crea un inmueble y queda a su nombre', async () => {
    const { respuesta } = await crearInmueble(dueno.token);

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.inmueble.id_propietario).toBe(dueno.sub);
    // Nace disponible: nadie lo ha arrendado todavía.
    expect(respuesta.body.inmueble.estado).toBe('disponible');
  });

  test('El id_propietario del cuerpo se ignora: manda el sub del token', async () => {
    // Regla dura 4. Si esto fallara, cualquiera podría registrar inmuebles a
    // nombre de otra persona con solo poner su UUID en el payload.
    const { respuesta } = await crearInmueble(dueno.token, { id_propietario: ajeno.sub });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.inmueble.id_propietario).toBe(dueno.sub);
  });

  test('El estado del cuerpo se ignora: no lo mueve una persona', async () => {
    // Aceptarlo permitiría marcar disponible un inmueble con contrato vigente.
    const { respuesta } = await crearInmueble(dueno.token, { estado: 'arrendado' });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.inmueble.estado).toBe('disponible');
  });

  test('Un tipo fuera del catálogo devuelve 400 con la lista completa', async () => {
    const respuesta = await request(app)
      .post('/api/inmuebles')
      .set(...conToken(dueno.token))
      .send(inmuebleValido({ tipo: 'mansión' }));

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body.mensaje).toContain('apartaestudio');
  });

  test('Los tipos del catálogo viejo ya no valen', async () => {
    // La columna era VARCHAR(50) libre y la base acumulaba "Casa" y "Apto".
    // Ahora "Casa" con mayúscula tampoco pasa: el catálogo va en minúsculas.
    for (const tipo of ['Casa', 'Apto', 'APARTAMENTO']) {
      const respuesta = await request(app)
        .post('/api/inmuebles')
        .set(...conToken(dueno.token))
        .send(inmuebleValido({ tipo }));

      expect(respuesta.statusCode).toBe(400);
    }
  });

  test('Sin dirección devuelve 400', async () => {
    const respuesta = await request(app)
      .post('/api/inmuebles')
      .set(...conToken(dueno.token))
      .send({ tipo: 'casa' });

    expect(respuesta.statusCode).toBe(400);
  });
});

describe('ABAC de pertenencia (regla dura 8, segundo nivel)', () => {
  let idDelDueno: string;

  beforeAll(async () => {
    const creado = await crearInmueble(dueno.token, { direccion: 'Carrera 7 #1-2' });
    idDelDueno = creado.id;
  });

  test('Un propietario ajeno recibe 404 al consultarlo', async () => {
    // 404 y no 403: distinguirlos confirmaría que el identificador existe.
    const respuesta = await request(app)
      .get(`/api/inmuebles/${idDelDueno}`)
      .set(...conToken(ajeno.token));

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.body.mensaje).toContain('no tienes permisos');
  });

  test('Un propietario ajeno recibe 404 al actualizarlo', async () => {
    const respuesta = await request(app)
      .put(`/api/inmuebles/${idDelDueno}`)
      .set(...conToken(ajeno.token))
      .send({ direccion: 'Hackeado' });

    expect(respuesta.statusCode).toBe(404);
  });

  test('Un propietario ajeno recibe 404 al borrarlo, y el inmueble sigue ahí', async () => {
    const respuesta = await request(app)
      .delete(`/api/inmuebles/${idDelDueno}`)
      .set(...conToken(ajeno.token));

    expect(respuesta.statusCode).toBe(404);

    const sigue = await request(app)
      .get(`/api/inmuebles/${idDelDueno}`)
      .set(...conToken(dueno.token));
    expect(sigue.statusCode).toBe(200);
  });

  test('El listado de un propietario ajeno no incluye inmuebles de otros', async () => {
    const respuesta = await request(app)
      .get('/api/inmuebles')
      .set(...conToken(ajeno.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).toEqual([]);
  });

  test('Un id que no es UUID responde 404, no 500', async () => {
    // findByPk con una cadena que no es UUID hace que PostgreSQL rechace el
    // tipo, y sin este corte el error saldría por el catch como 500.
    const respuesta = await request(app)
      .get('/api/inmuebles/no-soy-un-uuid')
      .set(...conToken(dueno.token));

    expect(respuesta.statusCode).toBe(404);
  });

  test('Un UUID que no existe responde 404', async () => {
    const respuesta = await request(app)
      .get(`/api/inmuebles/${crypto.randomUUID()}`)
      .set(...conToken(dueno.token));

    expect(respuesta.statusCode).toBe(404);
  });
});

describe('Capa 3: el servicio se defiende solo', () => {
  test('Sin token responde 401', async () => {
    const respuesta = await request(app).get('/api/inmuebles');

    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.body.mensaje).toContain('No se proporcionó un token');
  });

  test('Con token inválido responde 403', async () => {
    const respuesta = await request(app)
      .get('/api/inmuebles')
      .set('Authorization', 'Bearer token-de-mentira');

    expect(respuesta.statusCode).toBe(403);
  });

  test('Un inquilino no pasa, aunque el gateway lo hubiera dejado', async () => {
    // Confianza cero: la matriz RBAC del gateway ya lo habría cortado, pero
    // esta comprobación tiene que sostenerse sola.
    const respuesta = await request(app)
      .get('/api/inmuebles')
      .set(...conToken(arrendatario.token));

    expect(respuesta.statusCode).toBe(403);
  });

  test('El parámetro ?token= no autentica', async () => {
    const respuesta = await request(app).get(`/api/inmuebles?token=${dueno.token}`);

    expect(respuesta.statusCode).toBe(401);
  });
});

describe('Actualización', () => {
  let id: string;

  beforeAll(async () => {
    const creado = await crearInmueble(dueno.token, { direccion: 'Diagonal 1' });
    id = creado.id;
  });

  test('Cambia lo que le corresponde', async () => {
    const respuesta = await request(app)
      .put(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token))
      .send({ direccion: 'Diagonal 2', tipo: 'local' });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.inmueble.direccion).toBe('Diagonal 2');
    expect(respuesta.body.inmueble.tipo).toBe('local');
  });

  test('Una actualización parcial que no toca el tipo no lo exige', async () => {
    const respuesta = await request(app)
      .put(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token))
      .send({ barrio: 'Teusaquillo' });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.inmueble.tipo).toBe('local');
  });

  test('Un tipo inválido en la actualización devuelve 400', async () => {
    const respuesta = await request(app)
      .put(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token))
      .send({ tipo: 'castillo' });

    expect(respuesta.statusCode).toBe(400);
  });

  test('No se puede ceder el inmueble por el cuerpo', async () => {
    await request(app)
      .put(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token))
      .send({ id_propietario: ajeno.sub });

    const sigue = await request(app)
      .get(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token));

    expect(sigue.statusCode).toBe(200);
    expect(sigue.body.id_propietario).toBe(dueno.sub);
  });

  test('No se puede mover el estado por el cuerpo', async () => {
    await request(app)
      .put(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token))
      .send({ estado: 'arrendado' });

    const sigue = await request(app)
      .get(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token));

    expect(sigue.body.estado).toBe('disponible');
  });
});

describe('Borrado', () => {
  test('El dueño borra su inmueble', async () => {
    const { id } = await crearInmueble(dueno.token, { direccion: 'Para borrar' });

    const respuesta = await request(app)
      .delete(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token));

    expect(respuesta.statusCode).toBe(200);

    const despues = await request(app)
      .get(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token));
    expect(despues.statusCode).toBe(404);
  });

  test('Un inmueble ARRENDADO se borra igual: el veto es del gateway', async () => {
    // Documenta una decisión, no un descuido. La regla «no borrar con contrato
    // activo» existe y devuelve 409, pero vive en el gateway: depende de
    // Contratos, que es Core, y este servicio es de Soporte. Comprobarlo aquí
    // invertiría la dirección de las dependencias. Ver docs/adr/0011.
    const { id } = await crearInmueble(dueno.token, { direccion: 'Con contrato imaginario' });

    // Se ocupa como lo ocupa el sistema de verdad desde el paso 5: entregando
    // `ContratoFormalizado` por el bus. Ya no hay endpoint que mueva el estado.
    const arrendado = await request(app)
      .post('/interno/eventos')
      .set(...conServicio())
      .send({
        id_evento: crypto.randomUUID(),
        tipo: 'ContratoFormalizado',
        version: 1,
        ocurrido_en: new Date().toISOString(),
        payload: { id_contrato: crypto.randomUUID(), id_inmueble: id, canon: 1000, fecha_inicio_corte: '2026-01-01' }
      });
    expect(arrendado.statusCode).toBe(200);

    const respuesta = await request(app)
      .delete(`/api/inmuebles/${id}`)
      .set(...conToken(dueno.token));

    expect(respuesta.statusCode).toBe(200);
  });
});
