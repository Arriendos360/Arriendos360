/**
 * Contraseña temporal y cambio obligatorio.
 *
 * Lo que se fija aquí es lo que el ADR 0007 promete: que el servicio la genera,
 * que la devuelve UNA vez y nunca más, que marca al usuario, y que al cambiarla
 * el token anterior deja de servir.
 */

import bcrypt from 'bcryptjs';
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
import { ALFABETO, LONGITUD, generarContrasenaTemporal } from '../src/services/contrasenaTemporal';
import { TokenRevocado } from '../src/models/TokenRevocado';
import { Usuario } from '../src/models/Usuario';

let propietario: Sesion;

beforeAll(async () => {
  await recrearBase();
  propietario = await registrarPropietario({
    email: 'dueno@temporal.test',
    nombres: 'Ana',
    apellidos: 'Dueña',
    documento: '70000001',
  });
});

afterAll(async () => {
  await cerrarBase();
});

describe('Generador', () => {
  test('tiene la longitud fijada y sale del alfabeto declarado', () => {
    const clave = generarContrasenaTemporal();

    expect(clave).toHaveLength(LONGITUD);
    for (const caracter of clave) {
      expect(ALFABETO).toContain(caracter);
    }
  });

  test('no usa caracteres ambiguos', () => {
    // Alguien va a transcribirla a mano: una `l` confundida con un `1` produce
    // un bloqueo que parece un fallo del sistema.
    for (const ambiguo of ['0', 'O', '1', 'l', 'I']) {
      expect(ALFABETO).not.toContain(ambiguo);
    }
  });

  test('no se repite', () => {
    const generadas = new Set(Array.from({ length: 200 }, () => generarContrasenaTemporal()));
    expect(generadas.size).toBe(200);
  });
});

describe('Alta de inquilino', () => {
  let temporal: string;
  let idInquilino: string;

  test('devuelve la temporal una sola vez, sin pedirla', async () => {
    const respuesta = await request(app)
      .post('/api/usuarios/inquilinos')
      .set(...conToken(propietario.token))
      .send({
        nombres: 'Bruno',
        apellidos: 'Inquilino',
        email: 'bruno@temporal.test',
        telefono: '3001',
        documento: '70000002',
      });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.contrasena_temporal).toHaveLength(LONGITUD);
    expect(respuesta.body.usuario.debe_cambiar_contrasena).toBe(true);

    temporal = respuesta.body.contrasena_temporal;
    idInquilino = respuesta.body.usuario.id;
  });

  test('la temporal sirve para entrar', async () => {
    const sesion = await iniciarSesion('bruno@temporal.test', temporal);

    expect(sesion.status).toBe(200);
    expect(sesion.body.usuario.debe_cambiar_contrasena).toBe(true);
  });

  test('el token la anuncia, para que el gateway pueda bloquear', async () => {
    const sesion = await iniciarSesion('bruno@temporal.test', temporal);
    const claims = jwt.decode(sesion.body.token) as Record<string, unknown>;

    expect(claims['debe_cambiar']).toBe(true);
  });

  test('NO se guarda en claro: en la base sólo está su hash', async () => {
    const guardado = await Usuario.findByPk(idInquilino);

    expect(guardado!.contrasena).not.toBe(temporal);
    expect(guardado!.contrasena.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare(temporal, guardado!.contrasena)).toBe(true);
  });

  test('no vuelve a aparecer en ninguna consulta posterior', async () => {
    const busqueda = await request(app)
      .get('/api/usuarios?documento=70000002')
      .set(...conToken(propietario.token));
    expect(JSON.stringify(busqueda.body)).not.toContain(temporal);

    const interna = await request(app).get(`/interno/usuarios?ids=${idInquilino}`).set(...conServicio());
    expect(JSON.stringify(interna.body)).not.toContain(temporal);
    expect(interna.body.usuarios[0].contrasena).toBeUndefined();
    expect(interna.body.usuarios[0].contrasena_temporal).toBeUndefined();
  });

  test('si el cliente manda una contraseña, se ignora', async () => {
    // El propietario no elige la credencial de otra persona.
    const respuesta = await request(app)
      .post('/api/usuarios/inquilinos')
      .set(...conToken(propietario.token))
      .send({
        nombres: 'Carla',
        apellidos: 'Inquilina',
        email: 'carla@temporal.test',
        documento: '70000003',
        contrasena: 'la-que-yo-quiera',
      });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.contrasena_temporal).not.toBe('la-que-yo-quiera');

    const conLaSuya = await iniciarSesion('carla@temporal.test', 'la-que-yo-quiera');
    expect(conLaSuya.status).toBe(401);
  });

  test('el autorregistro NO marca cambio obligatorio', async () => {
    // Quien elige su propia contraseña no tiene nada que cambiar.
    const { login } = await registrarPropietario({
      email: 'propio@temporal.test',
      nombres: 'Elige',
      apellidos: 'Propia',
      documento: '70000004',
    });

    expect(login.body.usuario.debe_cambiar_contrasena).toBe(false);
    const claims = jwt.decode(login.body.token) as Record<string, unknown>;
    expect(claims['debe_cambiar']).toBe(false);
  });
});

describe('POST /api/auth/cambiar-contrasena', () => {
  let temporal: string;
  let token: string;

  beforeAll(async () => {
    const alta = await crearInquilino(propietario.token, {
      nombres: 'Diego',
      apellidos: 'Cambia',
      email: 'diego@temporal.test',
      documento: '70000005',
    });
    temporal = alta.respuesta.body.contrasena_temporal;

    const sesion = await iniciarSesion('diego@temporal.test', temporal);
    token = sesion.body.token;
  });

  test('sin token responde 401', async () => {
    const respuesta = await request(app).post('/api/auth/cambiar-contrasena').send({});
    expect(respuesta.status).toBe(401);
  });

  test('con la actual equivocada responde 401', async () => {
    const respuesta = await request(app)
      .post('/api/auth/cambiar-contrasena')
      .set(...conToken(token))
      .send({ contrasena_actual: 'no-es-esa', contrasena_nueva: 'MiClaveNueva1' });

    expect(respuesta.status).toBe(401);
  });

  test('rechaza una nueva demasiado corta', async () => {
    const respuesta = await request(app)
      .post('/api/auth/cambiar-contrasena')
      .set(...conToken(token))
      .send({ contrasena_actual: temporal, contrasena_nueva: 'corta' });

    expect(respuesta.status).toBe(400);
  });

  test('rechaza repetir la misma', async () => {
    // Si no, quedaría quitarse el indicador sin cambiar nada.
    const respuesta = await request(app)
      .post('/api/auth/cambiar-contrasena')
      .set(...conToken(token))
      .send({ contrasena_actual: temporal, contrasena_nueva: temporal });

    expect(respuesta.status).toBe(400);
  });

  test('cambia, levanta el indicador y devuelve un token nuevo', async () => {
    const respuesta = await request(app)
      .post('/api/auth/cambiar-contrasena')
      .set(...conToken(token))
      .send({ contrasena_actual: temporal, contrasena_nueva: 'MiClaveNueva1' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.usuario.debe_cambiar_contrasena).toBe(false);

    const nuevos = jwt.decode(respuesta.body.token) as Record<string, unknown>;
    expect(nuevos['debe_cambiar']).toBe(false);
    expect(respuesta.body.token).not.toBe(token);
  });

  test('revoca el token con el que se pidió el cambio', async () => {
    // Sin esto, el token viejo seguiría una hora afirmando que hay que cambiar
    // la contraseña, y el usuario quedaría atrapado en esa pantalla.
    const claims = jwt.decode(token) as { jti: string };
    expect(await TokenRevocado.findByPk(claims.jti)).not.toBeNull();

    const conElViejo = await request(app)
      .post('/api/auth/logout')
      .set(...conToken(token));
    expect(conElViejo.status).toBe(401);
  });

  test('la temporal deja de servir y la nueva entra sin indicador', async () => {
    expect((await iniciarSesion('diego@temporal.test', temporal)).status).toBe(401);

    const sesion = await iniciarSesion('diego@temporal.test', 'MiClaveNueva1');
    expect(sesion.status).toBe(200);
    expect(sesion.body.usuario.debe_cambiar_contrasena).toBe(false);
  });

  test('también sirve para un cambio voluntario', async () => {
    const sesion = await iniciarSesion('dueno@temporal.test');
    const respuesta = await request(app)
      .post('/api/auth/cambiar-contrasena')
      .set(...conToken(sesion.body.token))
      .send({ contrasena_actual: 'pass123', contrasena_nueva: 'OtraClave123' });

    expect(respuesta.status).toBe(200);
    expect((await iniciarSesion('dueno@temporal.test', 'OtraClave123')).status).toBe(200);
  });
});
