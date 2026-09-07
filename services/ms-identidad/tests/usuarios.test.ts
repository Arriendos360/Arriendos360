/**
 * Consulta de usuarios por documento y alta de inquilinos.
 *
 * La consulta es la pieza delicada: es lo que permite firmar un contrato, pero
 * también un oráculo sobre qué cédulas están registradas. Estas pruebas fijan
 * las tres restricciones que la acotan — coincidencia exacta, campos mínimos y
 * rastro de quién preguntó.
 */

import request from 'supertest';

import {
  app,
  cerrarBase,
  conToken,
  crearInquilino,
  recrearBase,
  registrarPropietario,
  type Sesion,
} from './utiles/entorno';
import { ConsultaDocumento } from '../src/models/ConsultaDocumento';

let propietario: Sesion;
let inquilinoId: string;

beforeAll(async () => {
  await recrearBase();

  propietario = await registrarPropietario({
    email: 'dueno@test.com',
    nombres: 'Ana',
    apellidos: 'Propietaria',
    documento: '10000001',
  });

  const alta = await crearInquilino(propietario.token, {
    email: 'inquilino@test.com',
    nombres: 'Bruno',
    apellidos: 'Inquilino',
    telefono: '3005555555',
    documento: '10000002',
  });
  inquilinoId = alta.id;
});

afterAll(async () => {
  await cerrarBase();
});

describe('Alta de inquilino', () => {
  test('devuelve 201 y el UUID que el contrato necesita', async () => {
    const alta = await crearInquilino(propietario.token, {
      email: 'otro_inq@test.com',
      nombres: 'Otro',
      apellidos: 'Inquilino',
      documento: '10000009',
    });

    expect(alta.respuesta.status).toBe(201);
    expect(alta.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(alta.respuesta.body.usuario.rol).toBe('INQUILINO');
  });

  test('la auditoría registra al propietario, no al propio inquilino', async () => {
    // Es la diferencia con el autorregistro, donde el autor es el usuario mismo.
    const { Usuario } = await import('../src/models/Usuario');
    const creado = await Usuario.findByPk(inquilinoId);

    expect(creado!.creado_por).toBe(propietario.id);
    expect(creado!.creado_por).not.toBe(inquilinoId);
  });
});

describe('GET /api/usuarios?documento=', () => {
  test('encuentra por coincidencia exacta', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios?documento=10000002')
      .set(...conToken(propietario.token));

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.id).toBe(inquilinoId);
    expect(respuesta.body.nombres).toBe('Bruno');
    expect(respuesta.body.apellidos).toBe('Inquilino');
  });

  test('devuelve únicamente id, nombres y apellidos', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios?documento=10000002')
      .set(...conToken(propietario.token));

    // Nada de contacto: quien busca no es necesariamente alguien con derecho a
    // los datos de un tercero.
    expect(Object.keys(respuesta.body).sort()).toEqual(['apellidos', 'id', 'nombres']);
    expect(respuesta.body.email).toBeUndefined();
    expect(respuesta.body.telefono).toBeUndefined();
    expect(respuesta.body.documento).toBeUndefined();
    expect(respuesta.body.contrasena).toBeUndefined();
  });

  test('no hace búsqueda parcial: un prefijo no encuentra nada', async () => {
    // Con `LIKE` esto sería un directorio de cédulas paginable.
    const respuesta = await request(app)
      .get('/api/usuarios?documento=1000000')
      .set(...conToken(propietario.token));

    expect(respuesta.status).toBe(404);
  });

  test('un documento inexistente responde 404', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios?documento=00000000')
      .set(...conToken(propietario.token));

    expect(respuesta.status).toBe(404);
  });

  test('sin parámetro responde 400', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios')
      .set(...conToken(propietario.token));

    expect(respuesta.status).toBe(400);
  });

  test('exige rol PROPIETARIO', async () => {
    const sesion = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inquilino@test.com', contrasena: 'pass123' });

    const respuesta = await request(app)
      .get('/api/usuarios?documento=10000001')
      .set(...conToken(sesion.body.token));

    expect(respuesta.status).toBe(403);
  });
});

describe('Registro de consultas', () => {
  test('deja rastro de quién consultó, qué documento y cuándo', async () => {
    await ConsultaDocumento.destroy({ where: {} });

    await request(app)
      .get('/api/usuarios?documento=10000002')
      .set(...conToken(propietario.token));

    const filas = await ConsultaDocumento.findAll();
    expect(filas).toHaveLength(1);
    expect(filas[0]!.id_consultante).toBe(propietario.id);
    expect(filas[0]!.documento).toBe('10000002');
    expect(filas[0]!.encontrado).toBe(true);
    expect(filas[0]!.consultada_en).toBeInstanceOf(Date);
  });

  test('registra también las consultas que no encuentran nada', async () => {
    // Es la señal que importa: un barrido se reconoce por la racha de fallos.
    await ConsultaDocumento.destroy({ where: {} });

    for (const documento of ['90000001', '90000002', '90000003']) {
      await request(app)
        .get(`/api/usuarios?documento=${documento}`)
        .set(...conToken(propietario.token));
    }

    const filas = await ConsultaDocumento.findAll();
    expect(filas).toHaveLength(3);
    expect(filas.every((f) => f.encontrado === false)).toBe(true);
  });

  test('no se expone por ninguna ruta de la API', async () => {
    // La tabla es operativa: se consulta con SQL cuando haya que investigar,
    // no por HTTP.
    for (const ruta of ['/api/usuarios/consultas', '/api/consultas', '/interno/consultas']) {
      const respuesta = await request(app).get(ruta).set(...conToken(propietario.token));
      expect(respuesta.status).toBe(404);
    }
  });
});
