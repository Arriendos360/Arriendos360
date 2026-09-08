import request from 'supertest';
import crypto from 'crypto';

import {
  app,
  cerrarEntorno,
  firmarToken,
  conServicio,
  conToken,
  crearContrato,
  inmuebleDe,
  inmueblesFalso,
  inquilino,
  inquilinoDe,
  prepararEntorno,
  propietario,
} from './utiles/entorno';

/**
 * La pertenencia de un contrato, que es la razon de ser de este servicio.
 *
 * ── LA PRUEBA QUE JUSTIFICA NO DENORMALIZAR ─────────────────────────────────
 *
 * La primera de la ultima seccion es la que sostiene el `docs/adr/0017`. Un
 * inmueble cambia de dueño en ms-inmuebles, NADA cambia en la tabla de
 * contratos, y aun asi el acceso se mueve: el nuevo propietario ve el contrato y
 * el anterior deja de verlo, en la peticion siguiente.
 *
 * Con `id_propietario` copiado en la fila, esa prueba fallaria — y el fallo en
 * produccion seria mudo: el propietario anterior seguiria descargandose contratos
 * de un inmueble que ya vendio, sin que nada lo delatara.
 */

let duenio: ReturnType<typeof propietario>;
let otro: ReturnType<typeof propietario>;
let arrendatario: ReturnType<typeof inquilino>;
let idInmueble: string;
let idInquilino: string;
let idContrato: string;

beforeAll(async () => {
  await prepararEntorno();

  duenio = propietario();
  otro = propietario();

  idInmueble = inmuebleDe(duenio.sub, 'Calle de la Pertenencia 1');
  idInquilino = inquilinoDe('Ana', 'Arrendataria');

  // El inquilino del contrato, con el MISMO sub que el usuario de identidad:
  // asi su token le identifica como la parte arrendataria.
  arrendatario = firmarToken({ sub: idInquilino, roles: ['INQUILINO'] });

  const creado = await crearContrato(duenio.token, idInmueble, idInquilino);
  idContrato = creado.id;
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('Las dos mitades de la disyuncion', () => {
  test('el dueño del inmueble ve el contrato', async () => {
    const respuesta = await request(app)
      .get('/api/contratos')
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.map((c: { id_contrato: string }) => c.id_contrato)).toContain(
      idContrato,
    );
  });

  test('el inquilino tambien, sin ser dueño de nada', async () => {
    const respuesta = await request(app)
      .get('/api/contratos')
      .set(...conToken(arrendatario.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.map((c: { id_contrato: string }) => c.id_contrato)).toContain(
      idContrato,
    );
  });

  test('un tercero no ve nada', async () => {
    const respuesta = await request(app)
      .get('/api/contratos')
      .set(...conToken(otro.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).toHaveLength(0);
  });

  test('y el detalle de un contrato ajeno responde 404, no 403', async () => {
    // 404 y no 403: un 403 confirmaria que ese identificador existe, que es
    // informacion que quien pregunta no tiene por que obtener probando UUID.
    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}`)
      .set(...conToken(otro.token));

    expect(respuesta.statusCode).toBe(404);
  });
});

describe('El orden de evaluacion: primero lo barato', () => {
  test('el inquilino sigue viendo su contrato aunque ms-inmuebles este caido', async () => {
    // `id_inquilino` esta en esta misma tabla: es una comparacion en memoria. La
    // mitad de propietario es la que cuesta un salto, y se comprueba despues.
    // Por eso el inquilino no depende de que Inmuebles conteste.
    inmueblesFalso().caer();

    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}`)
      .set(...conToken(arrendatario.token));

    inmueblesFalso().levantar();

    expect(respuesta.statusCode).toBe(200);
  });

  test('pero el propietario recibe 502, no 403 ni una lista vacia', async () => {
    // Decirle a alguien «no tienes permisos» cuando en realidad no se ha podido
    // comprobar es la peor de las respuestas posibles.
    inmueblesFalso().caer();

    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}`)
      .set(...conToken(duenio.token));

    inmueblesFalso().levantar();

    expect(respuesta.statusCode).toBe(502);
  });

  test('y el listado tambien: nunca una lista vacia creible y falsa', async () => {
    inmueblesFalso().caer();

    const respuesta = await request(app)
      .get('/api/contratos')
      .set(...conToken(duenio.token));

    inmueblesFalso().levantar();

    expect(respuesta.statusCode).toBe(502);
  });
});

describe('/interno resuelve la pertenencia para el gateway', () => {
  test('`parte` devuelve las dos mitades', async () => {
    const respuesta = await request(app)
      .get(`/interno/contratos?parte=${duenio.sub}`)
      .set(...conServicio());

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.contratos).toHaveLength(1);
  });

  test('`propietario` solo la de propietario', async () => {
    const comoInquilino = await request(app)
      .get(`/interno/contratos?propietario=${idInquilino}`)
      .set(...conServicio());

    expect(comoInquilino.body.contratos).toHaveLength(0);

    const comoParte = await request(app)
      .get(`/interno/contratos?parte=${idInquilino}`)
      .set(...conServicio());

    expect(comoParte.body.contratos).toHaveLength(1);
  });

  test('`inmueble` + `estado=activo` es lo que pregunta el guardia de borrado', async () => {
    const respuesta = await request(app)
      .get(`/interno/contratos?inmueble=${idInmueble}&estado=activo`)
      .set(...conServicio());

    expect(respuesta.body.contratos).toHaveLength(1);

    // Y despues de finalizarlo, ya no bloquea el borrado.
    await request(app)
      .put(`/api/contratos/${idContrato}/finalizar`)
      .set(...conToken(duenio.token));

    const despues = await request(app)
      .get(`/interno/contratos?inmueble=${idInmueble}&estado=activo`)
      .set(...conServicio());

    expect(despues.body.contratos).toHaveLength(0);
  });

  test('`ids` devuelve en lote, que es lo que evita el N+1 del gateway', async () => {
    const otroInmueble = inmuebleDe(duenio.sub, 'Segunda');
    const segundo = await crearContrato(duenio.token, otroInmueble, inquilinoDe());

    const respuesta = await request(app)
      .get(`/interno/contratos?ids=${idContrato},${segundo.id}`)
      .set(...conServicio());

    expect(respuesta.body.contratos).toHaveLength(2);
  });

  test('`/interno/contratos/:id?propietario=` es la comprobacion puntual', async () => {
    const suyo = await request(app)
      .get(`/interno/contratos/${idContrato}?propietario=${duenio.sub}`)
      .set(...conServicio());
    expect(suyo.statusCode).toBe(200);

    const ajeno = await request(app)
      .get(`/interno/contratos/${idContrato}?propietario=${otro.sub}`)
      .set(...conServicio());
    expect(ajeno.statusCode).toBe(404);
  });

  test('sin credencial de servicio, nada de esto responde', async () => {
    // Sin esto, cualquiera con acceso al puerto podria enumerar los contratos de
    // cualquier propietario.
    const respuesta = await request(app).get(`/interno/contratos?parte=${duenio.sub}`);
    expect(respuesta.statusCode).toBe(401);
  });

  test('sin filtro no se vuelca el catalogo entero', async () => {
    const respuesta = await request(app).get('/interno/contratos').set(...conServicio());
    expect(respuesta.statusCode).toBe(400);
  });
});

describe('Por que NO se denormaliza `id_propietario`', () => {
  test('cambiar de dueño el inmueble cambia quien ve el contrato', async () => {
    // ESTA ES LA PRUEBA DEL ADR 0017. No se toca la tabla de contratos: solo se
    // cambia el dueño del inmueble en el otro servicio. Con una copia guardada
    // aqui, el acceso se quedaria con el propietario anterior y nada lo diria.
    const comprador = propietario();
    const inmueble = inmuebleDe(duenio.sub, 'Se vende');
    const contrato = await crearContrato(duenio.token, inmueble, inquilinoDe());

    // Antes de la venta: lo ve el vendedor, no el comprador.
    expect(
      (
        await request(app)
          .get(`/api/contratos/${contrato.id}`)
          .set(...conToken(duenio.token))
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/contratos/${contrato.id}`)
          .set(...conToken(comprador.token))
      ).statusCode,
    ).toBe(404);

    // La venta ocurre EN MS-INMUEBLES. Aqui no se escribe nada.
    const fila = inmueblesFalso().inmuebles.get(inmueble) as { id_propietario: string };
    fila.id_propietario = comprador.sub;

    // Despues: lo ve el comprador, y el vendedor ya no.
    expect(
      (
        await request(app)
          .get(`/api/contratos/${contrato.id}`)
          .set(...conToken(comprador.token))
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/contratos/${contrato.id}`)
          .set(...conToken(duenio.token))
      ).statusCode,
    ).toBe(404);
  });

  test('y un contrato sobre un inmueble que ya no existe no es de nadie', async () => {
    // Caso degenerado que la copia tampoco resolveria bien: sin inmueble no hay
    // propietario, asi que solo queda la mitad del inquilino.
    const idHuerfano = crypto.randomUUID();
    const inquilinoHuerfano = inquilinoDe();
    const contrato = await crearContrato(
      duenio.token,
      inmuebleDe(duenio.sub, 'Efimero'),
      inquilinoHuerfano,
    );

    // Se borra el inmueble del otro servicio.
    for (const [id, inmueble] of inmueblesFalso().inmuebles) {
      if (inmueble.direccion === 'Efimero') {
        inmueblesFalso().inmuebles.delete(id);
      }
    }
    void idHuerfano;

    const respuesta = await request(app)
      .get(`/api/contratos/${contrato.id}`)
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(404);
  });
});
