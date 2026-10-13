import request from 'supertest';
import crypto from 'crypto';
import { hoyEnZonaNegocio, soloFecha, sumarDias } from 'arriendos360-shared';

import { Contrato } from '../src/models/Contrato';
import { HistorialContrato } from '../src/models/HistorialContrato';

import {
  app,
  cancelarContrato,
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
  test('cancelar deja el contrato en `cancelado`', async () => {
    const { id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino);

    const respuesta = await cancelarContrato(duenio.token, id);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.contrato.estado).toBe('cancelado');
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

  test('el alta no guarda el ajuste ni la constancia del preaviso del cuerpo, y la edición los rechaza', async () => {
    const delSistema = {
      fecha_ultimo_ajuste: '2030-01-01',
      preaviso_enviado_en: '2026-09-01T00:00:00Z',
      preaviso_enviado_por: duenio.sub,
      preaviso_vencimiento: '2026-12-31',
      preaviso_causal: 'compraventa',
    };
    const vacias = {
      fecha_ultimo_ajuste: null,
      preaviso_enviado_en: null,
      preaviso_enviado_por: null,
      preaviso_vencimiento: null,
      preaviso_causal: null,
    };

    const { respuesta, id } = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino, delSistema);
    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.contrato).toMatchObject(vacias);

    const edicion = await request(app)
      .put(`/api/contratos/${id}`)
      .set(...conToken(duenio.token))
      .send({ ...delSistema, info_contrato: 'Sin cambios de canon' });
    expect(edicion.statusCode).toBe(400);
    expect(edicion.body.errores.map((error: { campo: string }) => error.campo)).toEqual(Object.keys(delSistema));
    expect(await Contrato.findByPk(id)).toMatchObject({ ...vacias, info_contrato: null });
  });

  test('un `id` que no es UUID responde 404, no 500', async () => {
    const respuesta = await request(app)
      .get('/api/contratos/no-soy-un-uuid')
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(404);
  });
});

describe('Editar con lista blanca', () => {
  const hoy = hoyEnZonaNegocio();
  const enTerminoInicial = { inicio: sumarDias(hoy, -30), fin: sumarDias(hoy, 300) };

  const nuevo = async (fechas: Record<string, unknown> = enTerminoInicial) =>
    (await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino, { fecha_limite_pago: 5, ...fechas })).id;

  const editar = (id: string, cuerpo: Record<string, unknown>) =>
    request(app).put(`/api/contratos/${id}`).set(...conToken(duenio.token)).send(cuerpo);

  test('estado, corte, partes e inicio: 400 por cada uno y nada se aplica', async () => {
    const id = await nuevo();

    const respuesta = await editar(id, {
      canon: 1700000,
      estado: 'cancelado',
      fecha_inicio_corte: '2026-02-01',
      id_inmueble: crypto.randomUUID(),
      inicio: '2026-02-01',
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body.errores.map((error: { campo: string }) => error.campo)).toEqual([
      'estado',
      'fecha_inicio_corte',
      'id_inmueble',
      'inicio',
    ]);
    expect(await Contrato.findByPk(id)).toMatchObject({ estado: 'activo', canon: '1500000.00' });
  });

  test('el día límite de pago se cambia y deja su fila de historial', async () => {
    const id = await nuevo();

    const respuesta = await editar(id, { fecha_limite_pago: 10, canon: 1500000 });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.contrato.fecha_limite_pago).toBe(10);
    const filas = await HistorialContrato.findAll({ where: { id_contrato: id } });
    expect(filas.map((f) => [f.campo, f.valor_anterior, f.valor_nuevo, f.cambiado_por])).toEqual([
      ['fecha_limite_pago', '5', '10', duenio.sub],
    ]);
  });

  test('un contrato terminado no se edita: 409', async () => {
    const id = await nuevo();
    await Contrato.update({ estado: 'finalizado' }, { where: { id_contrato: id } });

    expect((await editar(id, { canon: 1600000 })).statusCode).toBe(409);
  });

  test('fin se extiende durante el término inicial', async () => {
    const id = await nuevo();

    expect((await editar(id, { fin: sumarDias(hoy, 400) })).statusCode).toBe(200);
    expect(soloFecha((await Contrato.findByPk(id))?.fin)).toBe(sumarDias(hoy, 400));
  });

  test('fin de un contrato prorrogado: 409', async () => {
    const id = await nuevo({ inicio: sumarDias(hoy, -400), fin: sumarDias(hoy, -35) });

    expect((await editar(id, { fin: sumarDias(hoy, 400) })).statusCode).toBe(409);
  });

  test('fin con preaviso registrado: 409', async () => {
    const id = await nuevo();
    await Contrato.update({ preaviso_enviado_en: new Date(), preaviso_vencimiento: enTerminoInicial.fin }, { where: { id_contrato: id } });

    expect((await editar(id, { fin: sumarDias(hoy, 400) })).statusCode).toBe(409);
  });

  test('fin hoy o en el pasado: 400 en fin', async () => {
    const id = await nuevo();

    for (const fin of [hoy, sumarDias(hoy, -1)]) {
      const respuesta = await editar(id, { fin });
      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.body.errores).toEqual([{ campo: 'fin', mensaje: expect.any(String) }]);
    }
  });

  test('fin enviado igual al actual no cuenta como cambio', async () => {
    const id = await nuevo({ inicio: sumarDias(hoy, -400), fin: sumarDias(hoy, -35) });

    expect((await editar(id, { fin: sumarDias(hoy, -35), info_contrato: 'Otrosí' })).statusCode).toBe(200);
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
