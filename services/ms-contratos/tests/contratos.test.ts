import request from 'supertest';
import crypto from 'crypto';

import {
  app,
  cerrarEntorno,
  conToken,
  contratoValido,
  crearContrato,
  identidadFalsa,
  inmuebleDe,
  inquilino,
  inquilinoDe,
  prepararEntorno,
  propietario,
} from './utiles/entorno';

/**
 * El ciclo de vida de un contrato, servido por su propio servicio.
 *
 * Estas afirmaciones venian de `apps/gateway/tests/contratos.test.js` y de la
 * parte de contratos de `security.test.js`. Se mudan con el codigo, palabra por
 * palabra donde se puede: el paso 6d NO cambia la logica de negocio, solo de
 * quien es. Que sigan diciendo lo mismo es la comprobacion de eso.
 */

let duenio: ReturnType<typeof propietario>;
let otro: ReturnType<typeof propietario>;
let arrendatario: ReturnType<typeof inquilino>;
let idInmueble: string;
let idInquilino: string;

beforeAll(async () => {
  await prepararEntorno();

  duenio = propietario();
  otro = propietario();
  arrendatario = inquilino();

  idInmueble = inmuebleDe(duenio.sub);
  idInquilino = inquilinoDe();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('Alta de contratos', () => {
  test('el propietario del inmueble puede firmar', async () => {
    const { respuesta, id } = await crearContrato(duenio.token, idInmueble, idInquilino);

    expect(respuesta.statusCode).toBe(201);
    expect(id).toBeDefined();
    expect(respuesta.body.contrato.estado).toBe('activo');
    // La auditoria queda a nombre de quien firmo.
    expect(respuesta.body.contrato.creado_por).toBe(duenio.sub);
  });

  test('las dos fechas del ciclo se derivan del inicio si no vienen', async () => {
    // El invariante vive en el hook del modelo, no en el controlador: las dos
    // columnas son NOT NULL y cualquier camino de escritura tiene que rellenarlas.
    const { respuesta } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino, {
      inicio: '2026-03-31',
      fin: '2027-03-30',
    });

    expect(respuesta.body.contrato.fecha_inicio_corte).toBe('2026-03-31');
    expect(respuesta.body.contrato.fecha_limite_pago).toBe(31);
  });

  test('un dia limite explicito gana sobre el derivado', async () => {
    // Es lo que permite renegociar el ciclo de facturacion sin mentir sobre el
    // inicio del contrato.
    const { respuesta } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino, {
      fecha_limite_pago: 5,
    });

    expect(respuesta.body.contrato.fecha_limite_pago).toBe(5);
  });

  test('un inmueble ajeno responde 403, no 404', async () => {
    // Aqui SI es 403: el inmueble existe y quien pregunta lo sabe, porque lo ha
    // nombrado. Lo que no tiene es permiso sobre el.
    const respuesta = await request(app)
      .post('/api/contratos')
      .set(...conToken(otro.token))
      .send(contratoValido(idInmueble, idInquilino));

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.body.mensaje).toContain('No tienes permisos');
  });

  test('un inquilino no puede firmar contratos, ni sobre inmuebles ajenos', async () => {
    // Capa 3 del modulo de seguridad: el gateway ya lo habria parado con la
    // matriz, y este servicio lo vuelve a comprobar (regla dura 7).
    const respuesta = await request(app)
      .post('/api/contratos')
      .set(...conToken(arrendatario.token))
      .send(contratoValido(idInmueble, idInquilino));

    expect(respuesta.statusCode).toBe(403);
  });

  test('la fecha de fin tiene que ser posterior a la de inicio', async () => {
    const respuesta = await request(app)
      .post('/api/contratos')
      .set(...conToken(duenio.token))
      .send(contratoValido(idInmueble, idInquilino, { inicio: '2026-12-31', fin: '2026-01-01' }));

    expect(respuesta.statusCode).toBe(400);
  });

  test('el canon tiene que ser positivo', async () => {
    const respuesta = await request(app)
      .post('/api/contratos')
      .set(...conToken(duenio.token))
      .send(contratoValido(idInmueble, idInquilino, { canon: 0 }));

    expect(respuesta.statusCode).toBe(400);
  });

  test('un dia limite fuera de 1-31 es un 400, no un 500', async () => {
    // Un dato del cliente que no vale. Sin esta validacion saldria por el `catch`
    // como un 500 con el mensaje de Sequelize dentro.
    const respuesta = await request(app)
      .post('/api/contratos')
      .set(...conToken(duenio.token))
      .send(contratoValido(idInmueble, idInquilino, { fecha_limite_pago: 32 }));

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body.mensaje).toContain('día del mes');
  });

  test('un id_inquilino que no es UUID responde 404, no 500', async () => {
    // Regresion del paso a UUID: antes `id_inquilino` era la cedula. Si llega una
    // cedula vieja, PostgreSQL rechazaria el tipo y Sequelize lo propagaria como
    // 500. Tiene que ser el 404 de «inquilino no encontrado».
    const respuesta = await request(app)
      .post('/api/contratos')
      .set(...conToken(duenio.token))
      .send(contratoValido(idInmueble, '333'));

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.body.error_code).toBe('TENANT_NOT_FOUND');
  });

  test('un usuario que existe pero NO es inquilino tampoco vale', async () => {
    // El rol se comprueba, no se supone: firmar un contrato contra un
    // propietario dejaria un arriendo sin arrendatario.
    const idPropietarioAjeno = crypto.randomUUID();
    identidadFalsa().usuarios.set(idPropietarioAjeno, {
      id: idPropietarioAjeno,
      nombres: 'Otro',
      apellidos: 'Propietario',
      roles: ['PROPIETARIO'],
    });

    const respuesta = await request(app)
      .post('/api/contratos')
      .set(...conToken(duenio.token))
      .send(contratoValido(idInmueble, idPropietarioAjeno));

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.body.error_code).toBe('TENANT_NOT_FOUND');
  });
});

describe('El listado compone lo que la pantalla pinta', () => {
  test('cada contrato trae su Inmueble y su Inquilino', async () => {
    // Las dos rutas que la SPA lee desde antes de que Inmuebles se extrajera.
    // Han sobrevivido a dos extracciones sin cambiar de forma, y esa continuidad
    // es deliberada. Ver `services/composicion.ts`.
    const respuesta = await request(app)
      .get('/api/contratos')
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);

    const contrato = respuesta.body.find(
      (c: { id_inmueble: string }) => c.id_inmueble === idInmueble,
    );
    expect(contrato.Inmueble.direccion).toBe('Calle 123 #45-67');
    expect(contrato.Inquilino.nombres).toBe('Inq');
  });

  test('si ms-identidad no responde, el Inquilino queda en null y el listado sale', async () => {
    // Componer DEGRADA; autorizar no. Un contrato sin el nombre del inquilino
    // sigue siendo util, y el frontend ya lo maneja.
    identidadFalsa().caer();

    const respuesta = await request(app)
      .get('/api/contratos')
      .set(...conToken(duenio.token));

    identidadFalsa().levantar();

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body[0].Inquilino).toBeNull();
    // Y el inmueble sigue ahi: son dos peticiones independientes.
    expect(respuesta.body[0].Inmueble).not.toBeNull();
  });
});

describe('Finalizar y actualizar', () => {
  test('finalizar deja el contrato en `finalizado`', async () => {
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino);

    const respuesta = await request(app)
      .put(`/api/contratos/${id}/finalizar`)
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.contrato.estado).toBe('finalizado');
  });

  test('un contrato ajeno no se finaliza, y responde 404', async () => {
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino);

    const respuesta = await request(app)
      .put(`/api/contratos/${id}/finalizar`)
      .set(...conToken(otro.token));

    expect(respuesta.statusCode).toBe(404);
  });

  test('actualizar registra al EDITOR, no al creador', async () => {
    // El hook de auditoria, por el camino que de verdad se usa.
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino);

    const respuesta = await request(app)
      .put(`/api/contratos/${id}`)
      .set(...conToken(duenio.token))
      .send({ canon: 1600000 });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.contrato.actualizado_por).toBe(duenio.sub);
    expect(parseFloat(respuesta.body.contrato.canon)).toBe(1600000);
  });

  test('un `id` que no es UUID responde 404, no 500', async () => {
    const respuesta = await request(app)
      .get('/api/contratos/no-soy-un-uuid')
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(404);
  });
});

describe('Reemision de la contraseña temporal del inquilino', () => {
  test('el propietario del contrato puede pedirla', async () => {
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino);

    const respuesta = await request(app)
      .post(`/api/contratos/${id}/contrasena-inquilino`)
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.contrasena_temporal).toBeDefined();

    // La auditoria del otro lado registra a la PERSONA, no al servicio que
    // transmitio. Ver `clientes/identidad.ts`.
    const ultima = identidadFalsa().reemisiones.at(-1);
    expect(ultima?.solicitado_por).toBe(duenio.sub);
    expect(ultima?.id).toBe(idInquilino);
  });

  test('un contrato ajeno responde 404, sin llegar a pedirla', async () => {
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino);
    const antes = identidadFalsa().reemisiones.length;

    const respuesta = await request(app)
      .post(`/api/contratos/${id}/contrasena-inquilino`)
      .set(...conToken(otro.token));

    expect(respuesta.statusCode).toBe(404);
    // Lo importante: NO se llamo a ms-identidad. Comprobar la pertenencia antes
    // de actuar es lo que evita reemitir una credencial ajena.
    expect(identidadFalsa().reemisiones).toHaveLength(antes);
  });
});
