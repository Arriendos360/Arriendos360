/**
 * Autenticación de MS-Identidad: registro, login, logout y revocación.
 *
 * Es la misma cobertura que tenía el monolito en `apps/gateway/tests/auth.test.js`,
 * ejecutada ahora contra el servicio extraído. Que las dos pasen a la vez es lo
 * que demuestra que la extracción no cambió el comportamiento.
 */

import jwt from 'jsonwebtoken';
import request from 'supertest';

import {
  app,
  cerrarBase,
  conServicio,
  conToken,
  crearInquilino,
  iniciarSesion,
  recrearBase,
  registrarPropietario,
  type Sesion,
} from './utiles/entorno';
import { ROLES, USUARIO_SISTEMA } from '../src/models/constantes';
import { RolUsuario } from '../src/models/RolUsuario';
import { TokenRevocado } from '../src/models/TokenRevocado';

let propietario: Sesion;

beforeAll(async () => {
  await recrearBase();
  propietario = await registrarPropietario({
    email: 'logout@test.com',
    nombres: 'Cierra',
    apellidos: 'Sesion',
    documento: '4001',
  });
});

afterAll(async () => {
  await cerrarBase();
});

describe('Registro', () => {
  test('crea un PROPIETARIO y devuelve 201', async () => {
    const respuesta = await request(app).post('/api/auth/registro').send({
      nombres: 'Test',
      apellidos: 'User',
      email: 'test_unit@example.com',
      contrasena: 'password123',
      telefono: '1234567',
      documento: '999888',
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.usuario.rol).toBe('PROPIETARIO');
    expect(respuesta.body.usuario.email).toBe('test_unit@example.com');
  });

  test('rechaza un documento repetido', async () => {
    const respuesta = await request(app).post('/api/auth/registro').send({
      nombres: 'Otro',
      apellidos: 'Usuario',
      email: 'otro@example.com',
      contrasena: 'password123',
      documento: '999888',
    });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.mensaje).toContain('documento');
  });

  test('rechaza un email repetido', async () => {
    const respuesta = await request(app).post('/api/auth/registro').send({
      nombres: 'Otro',
      apellidos: 'Usuario',
      email: 'test_unit@example.com',
      contrasena: 'password123',
      documento: '111222',
    });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.mensaje).toContain('email');
  });

  test('no acepta el rol desde el cuerpo', async () => {
    const { login } = await registrarPropietario({
      email: 'intruso@example.com',
      documento: '777666',
      nombres: 'Intruso',
      apellidos: 'Prueba',
      rol: 'INQUILINO',
    });

    expect(login.body.usuario.roles).toEqual(['PROPIETARIO']);
  });

  test('exige los campos obligatorios', async () => {
    const respuesta = await request(app)
      .post('/api/auth/registro')
      .send({ nombres: 'Sin', apellidos: 'Documento', email: 'sin@doc.com', contrasena: 'x' });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.mensaje).toContain('documento');
  });
});

describe('Login', () => {
  test('devuelve token, tipo_token, expiracion y usuario', async () => {
    const respuesta = await iniciarSesion('logout@test.com');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.tipo_token).toBe('Bearer');
    expect(typeof respuesta.body.expiracion).toBe('string');

    const faltan = (new Date(respuesta.body.expiracion).getTime() - Date.now()) / 1000;
    expect(faltan).toBeGreaterThan(3500);
    expect(faltan).toBeLessThanOrEqual(3600);

    expect(respuesta.body.usuario.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  test('contraseña incorrecta responde 401', async () => {
    const respuesta = await iniciarSesion('logout@test.com', 'no-es');
    expect(respuesta.status).toBe(401);
  });

  test('usuario inexistente responde 404', async () => {
    const respuesta = await iniciarSesion('nadie@test.com');
    expect(respuesta.status).toBe(404);
  });

  test('sin email ni contraseña responde 400, no 500', async () => {
    const respuesta = await request(app).post('/api/auth/login').send({});
    expect(respuesta.status).toBe(400);
  });
});

describe('Claims del token', () => {
  test('lleva sub, email, roles, jti y exp a una hora', () => {
    const claims = jwt.decode(propietario.token) as Record<string, unknown>;

    expect(claims['sub']).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(claims['email']).toBe('logout@test.com');
    expect(claims['roles']).toEqual(['PROPIETARIO']);
    expect(claims['jti']).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect((claims['exp'] as number) - (claims['iat'] as number)).toBe(3600);
  });

  test('ya no lleva id_perfil ni rol singular', () => {
    const claims = jwt.decode(propietario.token) as Record<string, unknown>;
    expect(claims['id_perfil']).toBeUndefined();
    expect(claims['rol']).toBeUndefined();
  });
});

describe('Logout y revocación', () => {
  test('sin token responde 401', async () => {
    const respuesta = await request(app).post('/api/auth/logout');
    expect(respuesta.status).toBe(401);
  });

  test('anota el jti en TokensRevocados hasta su expiración natural', async () => {
    const sesion = await iniciarSesion('logout@test.com');
    const claims = jwt.decode(sesion.body.token) as { jti: string; exp: number };

    const respuesta = await request(app)
      .post('/api/auth/logout')
      .set(...conToken(sesion.body.token));

    expect(respuesta.status).toBe(200);

    const revocado = await TokenRevocado.findByPk(claims.jti);
    expect(revocado).not.toBeNull();
    expect(Math.round(revocado!.expira_en.getTime() / 1000)).toBe(claims.exp);
  });

  test('un token revocado deja de servir aunque la firma siga siendo válida', async () => {
    const sesion = await iniciarSesion('logout@test.com');
    const token = sesion.body.token;

    await request(app).post('/api/auth/logout').set(...conToken(token));

    // La firma sigue verificando: lo que cambió es la lista de revocados.
    expect(() => jwt.verify(token, process.env['JWT_SECRET'] as string)).not.toThrow();

    const despues = await request(app)
      .get('/api/usuarios?documento=4001')
      .set(...conToken(token));
    expect(despues.status).toBe(401);
  });

  test('revocar una sesión no afecta a las demás del mismo usuario', async () => {
    const movil = await iniciarSesion('logout@test.com');
    const escritorio = await iniciarSesion('logout@test.com');

    await request(app).post('/api/auth/logout').set(...conToken(movil.body.token));

    const respuesta = await request(app)
      .get('/api/usuarios?documento=4001')
      .set(...conToken(escritorio.body.token));

    expect(respuesta.status).toBe(200);
  });

  test('una revocación vencida deja de tener efecto', async () => {
    // Es lo que hace innecesario el barrido: la consulta filtra por
    // `expira_en > NOW()`, así que una fila del pasado no bloquea nada.
    const sesion = await iniciarSesion('logout@test.com');
    const claims = jwt.decode(sesion.body.token) as { jti: string };

    await TokenRevocado.create({ jti: claims.jti, expira_en: new Date(Date.now() - 60_000) });

    const respuesta = await request(app)
      .get('/api/usuarios?documento=4001')
      .set(...conToken(sesion.body.token));

    expect(respuesta.status).toBe(200);
  });

  test('un token sin jti se rechaza: es de la forma anterior al paso 3a', async () => {
    const antiguo = jwt.sign(
      { id: 1, correo: 'logout@test.com', rol: 'propietario', id_perfil: '4001' },
      process.env['JWT_SECRET'] as string,
      { expiresIn: '1h' },
    );

    const respuesta = await request(app)
      .get('/api/usuarios?documento=4001')
      .set(...conToken(antiguo));

    expect(respuesta.status).toBe(403);
  });
});

describe('GET /interno/revocados', () => {
  test('lista sólo los jti vigentes, para la caché del gateway', async () => {
    const sesion = await iniciarSesion('logout@test.com');
    const claims = jwt.decode(sesion.body.token) as { jti: string };
    await request(app).post('/api/auth/logout').set(...conToken(sesion.body.token));

    const vencido = '33333333-3333-4333-8333-333333333333';
    await TokenRevocado.create({ jti: vencido, expira_en: new Date(Date.now() - 60_000) });

    const respuesta = await request(app).get('/interno/revocados').set(...conServicio());

    expect(respuesta.status).toBe(200);
    const jtis = (respuesta.body.revocados as Array<{ jti: string }>).map((r) => r.jti);
    expect(jtis).toContain(claims.jti);
    // El vencido no viaja: la caché del gateway no tiene por qué cargar con él.
    expect(jtis).not.toContain(vencido);
  });
});

describe('Roles múltiples', () => {
  test('un usuario con los dos roles los lleva ambos en los claims', async () => {
    const doble = await registrarPropietario({
      email: 'ambos@test.com',
      nombres: 'Carmen',
      apellidos: 'Ambos',
      documento: '4002',
    });

    await RolUsuario.create(
      { id_rol: ROLES['INQUILINO'], id_usuario: doble.id, creado_por: USUARIO_SISTEMA },
      { usuarioAuditor: USUARIO_SISTEMA } as never,
    );

    const sesion = await iniciarSesion('ambos@test.com');
    const claims = jwt.decode(sesion.body.token) as { roles: string[] };

    expect(claims.roles.sort()).toEqual(['INQUILINO', 'PROPIETARIO']);
    // El rol singular de la respuesta es el principal, no una contradicción.
    expect(sesion.body.usuario.rol).toBe('PROPIETARIO');
  });
});

describe('Confianza cero', () => {
  test('el servicio verifica el token por su cuenta, sin fiarse del gateway', async () => {
    // Una petición que llega directamente al servicio, sin pasar por el gateway
    // y sin token, se rechaza igual.
    const respuesta = await request(app).get('/api/usuarios?documento=4001');
    expect(respuesta.status).toBe(401);
  });

  test('un token firmado con otro secreto no cuela', async () => {
    const falso = jwt.sign(
      { sub: '11111111-1111-4111-8111-111111111111', email: 'x@y.z', roles: ['PROPIETARIO'], jti: '22222222-2222-4222-8222-222222222222' },
      'otro-secreto-distinto',
      { expiresIn: '1h' },
    );

    const respuesta = await request(app)
      .get('/api/usuarios?documento=4001')
      .set(...conToken(falso));

    expect(respuesta.status).toBe(403);
  });

  test('un inquilino no puede dar de alta a otro usuario', async () => {
    await crearInquilino(propietario.token, {
      email: 'inq_alta@test.com',
      nombres: 'Inq',
      apellidos: 'Alta',
      documento: '4003',
    });

    const sesion = await iniciarSesion('inq_alta@test.com');
    const intento = await request(app)
      .post('/api/usuarios/inquilinos')
      .set(...conToken(sesion.body.token))
      .send({
        email: 'otro@test.com',
        contrasena: 'pass123',
        nombres: 'Otro',
        apellidos: 'Usuario',
        documento: '4004',
      });

    expect(intento.status).toBe(403);
  });
});
