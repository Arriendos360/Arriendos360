/**
 * Recuperación de contraseña.
 *
 * Lo que se fija: que `/recuperar` no delate qué correos existen, que el enlace
 * sea de un solo uso y caduque, y que al restablecer caigan todas las sesiones
 * abiertas — que es el motivo por el que alguien restablece su contraseña.
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
import { TokenRecuperacion } from '../src/models/TokenRecuperacion';
import { Usuario } from '../src/models/Usuario';
import { NotificadorNulo, usarNotificador } from '../src/services/notificador';
import { VIGENCIA_MINUTOS, hashDeToken } from '../src/services/recuperacion';
import { tokenInvalidado } from '../src/services/tokenService';

let propietario: Sesion;
let buzon: NotificadorNulo;

/** Saca el token del enlace que viajó en el correo. */
const tokenDelUltimoCorreo = (): string => {
  const ultimo = buzon.enviadas[buzon.enviadas.length - 1];
  const encontrado = /token=([a-f0-9]+)/.exec(ultimo?.cuerpoHtml ?? '');
  return encontrado?.[1] ?? '';
};

beforeAll(async () => {
  await recrearBase();
  buzon = new NotificadorNulo();
  usarNotificador(buzon);

  propietario = await registrarPropietario({
    email: 'olvidadizo@test.com',
    nombres: 'Olvi',
    apellidos: 'Dadizo',
    documento: '80000001',
  });
});

afterAll(async () => {
  await cerrarBase();
});

describe('POST /api/auth/recuperar', () => {
  test('responde lo mismo con un email que existe y con uno que no', async () => {
    // Es el requisito central: si la respuesta cambiara, la API sería un
    // verificador de cuentas registradas.
    const existe = await request(app)
      .post('/api/auth/recuperar')
      .send({ email: 'olvidadizo@test.com' });
    const noExiste = await request(app)
      .post('/api/auth/recuperar')
      .send({ email: 'nadie@test.com' });

    expect(existe.status).toBe(noExiste.status);
    expect(existe.body).toEqual(noExiste.body);
    expect(existe.status).toBe(200);
  });

  test('sólo envía correo si la cuenta existe', async () => {
    buzon.enviadas.length = 0;
    await request(app).post('/api/auth/recuperar').send({ email: 'nadie@test.com' });
    expect(buzon.enviadas).toHaveLength(0);

    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });
    expect(buzon.enviadas).toHaveLength(1);
    expect(buzon.enviadas[0]!.para).toBe('olvidadizo@test.com');
  });

  test('el correo lleva un enlace con el token', async () => {
    buzon.enviadas.length = 0;
    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });

    expect(buzon.enviadas[0]!.cuerpoHtml).toContain('/restablecer?token=');
    expect(tokenDelUltimoCorreo()).toMatch(/^[a-f0-9]{64}$/);
  });

  test('el token se guarda hasheado, nunca en claro', async () => {
    buzon.enviadas.length = 0;
    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });
    const token = tokenDelUltimoCorreo();

    expect(await TokenRecuperacion.findOne({ where: { hash_token: token } })).toBeNull();
    expect(
      await TokenRecuperacion.findOne({ where: { hash_token: hashDeToken(token) } }),
    ).not.toBeNull();
  });

  test('pedirlo otra vez invalida el enlace anterior', async () => {
    buzon.enviadas.length = 0;
    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });
    const viejo = tokenDelUltimoCorreo();

    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });

    const conElViejo = await request(app)
      .post('/api/auth/restablecer')
      .send({ token: viejo, contrasena_nueva: 'NuevaClave123' });

    expect(conElViejo.status).toBe(400);
  });

  test('sin email responde 400', async () => {
    const respuesta = await request(app).post('/api/auth/recuperar').send({});
    expect(respuesta.status).toBe(400);
  });
});

describe('POST /api/auth/restablecer', () => {
  const pedirEnlace = async (email: string): Promise<string> => {
    buzon.enviadas.length = 0;
    await request(app).post('/api/auth/recuperar').send({ email });
    return tokenDelUltimoCorreo();
  };

  test('cambia la contraseña y la nueva sirve para entrar', async () => {
    const token = await pedirEnlace('olvidadizo@test.com');

    const respuesta = await request(app)
      .post('/api/auth/restablecer')
      .send({ token, contrasena_nueva: 'RestablecidaOk1' });

    expect(respuesta.status).toBe(200);
    expect((await iniciarSesion('olvidadizo@test.com', 'RestablecidaOk1')).status).toBe(200);
  });

  test('no devuelve token: hay que volver a entrar por el login', async () => {
    // Darle sesión aquí convertiría el enlace del correo en un acceso directo.
    const token = await pedirEnlace('olvidadizo@test.com');
    const respuesta = await request(app)
      .post('/api/auth/restablecer')
      .send({ token, contrasena_nueva: 'OtraMasNueva1' });

    expect(respuesta.body.token).toBeUndefined();
  });

  test('un token YA USADO no vuelve a servir', async () => {
    const token = await pedirEnlace('olvidadizo@test.com');

    const primera = await request(app)
      .post('/api/auth/restablecer')
      .send({ token, contrasena_nueva: 'PrimeraVez123' });
    expect(primera.status).toBe(200);

    const segunda = await request(app)
      .post('/api/auth/restablecer')
      .send({ token, contrasena_nueva: 'SegundaVez123' });
    expect(segunda.status).toBe(400);

    // Y la contraseña siguió siendo la de la primera vez.
    expect((await iniciarSesion('olvidadizo@test.com', 'PrimeraVez123')).status).toBe(200);
  });

  test('un token VENCIDO no sirve', async () => {
    const token = await pedirEnlace('olvidadizo@test.com');

    await TokenRecuperacion.update(
      { expira_en: new Date(Date.now() - 60_000) },
      { where: { hash_token: hashDeToken(token) } },
    );

    const respuesta = await request(app)
      .post('/api/auth/restablecer')
      .send({ token, contrasena_nueva: 'DemasiadoTarde1' });

    expect(respuesta.status).toBe(400);
  });

  test('la vigencia es de 30 minutos', async () => {
    const token = await pedirEnlace('olvidadizo@test.com');
    const registro = await TokenRecuperacion.findOne({ where: { hash_token: hashDeToken(token) } });

    const minutos = (registro!.expira_en.getTime() - Date.now()) / 60000;
    expect(minutos).toBeGreaterThan(VIGENCIA_MINUTOS - 1);
    expect(minutos).toBeLessThanOrEqual(VIGENCIA_MINUTOS);
  });

  test('un token inventado no sirve, y responde igual que uno vencido', async () => {
    const inventado = await request(app)
      .post('/api/auth/restablecer')
      .send({ token: 'a'.repeat(64), contrasena_nueva: 'NoImporta123' });

    expect(inventado.status).toBe(400);
  });

  test('rechaza una contraseña demasiado corta', async () => {
    const token = await pedirEnlace('olvidadizo@test.com');
    const respuesta = await request(app)
      .post('/api/auth/restablecer')
      .send({ token, contrasena_nueva: 'corta' });

    expect(respuesta.status).toBe(400);
  });
});

describe('Al restablecer caen las sesiones abiertas', () => {
  test('un token emitido ANTES del cambio queda inválido', async () => {
    // Es el punto del endpoint: quien restablece su contraseña normalmente lo
    // hace porque sospecha que alguien más está dentro, y no sabe cuántas
    // sesiones hay ni cuáles. Revocar las conocidas no serviría de nada.
    const usuario = await registrarPropietario({
      email: 'sesiones@test.com',
      nombres: 'Con',
      apellidos: 'Sesiones',
      documento: '80000002',
    });

    const claimsViejos = jwt.decode(usuario.token) as { sub: string; jti: string; iat: number };
    expect(await tokenInvalidado(claimsViejos as never)).toBe(false);

    buzon.enviadas.length = 0;
    await request(app).post('/api/auth/recuperar').send({ email: 'sesiones@test.com' });
    const token = tokenDelUltimoCorreo();

    await request(app)
      .post('/api/auth/restablecer')
      .send({ token, contrasena_nueva: 'TodoCaido123' });

    expect(await tokenInvalidado(claimsViejos as never)).toBe(true);
  });

  test('el token viejo deja de valer contra la API', async () => {
    const usuario = await registrarPropietario({
      email: 'sesiones2@test.com',
      nombres: 'Con',
      apellidos: 'Sesiones2',
      documento: '80000003',
    });

    expect(
      (await request(app).get('/api/usuarios?documento=80000003').set(...conToken(usuario.token)))
        .status,
    ).toBe(200);

    buzon.enviadas.length = 0;
    await request(app).post('/api/auth/recuperar').send({ email: 'sesiones2@test.com' });
    await request(app)
      .post('/api/auth/restablecer')
      .send({ token: tokenDelUltimoCorreo(), contrasena_nueva: 'YaNoVale1234' });

    const despues = await request(app)
      .get('/api/usuarios?documento=80000003')
      .set(...conToken(usuario.token));
    expect(despues.status).toBe(401);
  });

  test('el que entra JUSTO DESPUÉS de restablecer recibe un token que sirve', async () => {
    // Regresión. La marca de cambio se redondea hacia ARRIBA y el `iat` de un
    // JWT hacia ABAJO, así que un login en el mismo segundo que el
    // restablecimiento nacía del lado malo de la comparación y se invalidaba a
    // sí mismo: 200 al entrar y 401 en la petición siguiente.
    //
    // Se hacía visible como una suite intermitente —fallaba cuando login y
    // restablecimiento caían en el mismo segundo— pero el fallo era del
    // producto: es exactamente lo que hace una persona tras restablecer.
    const usuario = await registrarPropietario({
      email: 'entra-rapido@test.com',
      nombres: 'Entra',
      apellidos: 'Rapido',
      documento: '80000005',
    });
    expect(usuario.login.status).toBe(200);

    buzon.enviadas.length = 0;
    await request(app).post('/api/auth/recuperar').send({ email: 'entra-rapido@test.com' });
    await request(app)
      .post('/api/auth/restablecer')
      .send({ token: tokenDelUltimoCorreo(), contrasena_nueva: 'RecienPuesta1' });

    // Sin pausa a propósito: el mismo segundo es justo el caso que falla.
    const sesion = await iniciarSesion('entra-rapido@test.com', 'RecienPuesta1');
    expect(sesion.status).toBe(200);

    const claims = jwt.decode(sesion.body.token) as { sub: string; jti: string; iat: number };
    expect(await tokenInvalidado(claims as never)).toBe(false);

    // Y la comprobación que muerde SIEMPRE, caiga donde caiga el reloj: el
    // `iat` del token nuevo nunca queda por detrás de la marca de su usuario.
    // Sin esto la prueba solo fallaría cuando login y restablecimiento cayeran
    // en el mismo segundo, que es como se coló el fallo la primera vez.
    const fila = await Usuario.findOne({ where: { email: 'entra-rapido@test.com' } });
    expect(claims.iat * 1000).toBeGreaterThanOrEqual(fila!.contrasena_cambiada_en!.getTime());

    const usando = await request(app)
      .get('/api/usuarios?documento=80000005')
      .set(...conToken(sesion.body.token));
    expect(usando.status).toBe(200);
  });

  test('la marca aparece en la lista que consume el gateway', async () => {
    const respuesta = await request(app).get('/interno/revocados').set(...conServicio());

    expect(Array.isArray(respuesta.body.sesiones)).toBe(true);
    const subs = (respuesta.body.sesiones as Array<{ sub: string }>).map((s) => s.sub);
    const usuario = await Usuario.findOne({ where: { email: 'sesiones2@test.com' } });
    expect(subs).toContain(usuario!.id_usuario);
  });
});

describe('Reemisión de la contraseña temporal', () => {
  /**
   * Sesión nueva del propietario.
   *
   * La de `beforeAll` ya no vale: las pruebas de restablecimiento cambiaron su
   * contraseña, y eso tira todas sus sesiones. Que haya que renovarla aquí es la
   * funcionalidad haciendo exactamente lo que promete.
   */
  let tokenPropietario: string;

  beforeAll(async () => {
    const sesion = await iniciarSesion('olvidadizo@test.com', 'PrimeraVez123');
    tokenPropietario = sesion.body.token;
  });

  test('regenera, devuelve una vez y vuelve a marcar cambio obligatorio', async () => {
    const alta = await crearInquilino(tokenPropietario, {
      nombres: 'Reemi',
      apellidos: 'Tido',
      email: 'reemitido@test.com',
      documento: '80000004',
    });
    const primera = alta.respuesta.body.contrasena_temporal;

    // Cambia su contraseña, con lo que deja de estar marcado.
    const sesion = await iniciarSesion('reemitido@test.com', primera);
    await request(app)
      .post('/api/auth/cambiar-contrasena')
      .set(...conToken(sesion.body.token))
      .send({ contrasena_actual: primera, contrasena_nueva: 'ElegidaPorMi1' });

    const reemision = await request(app)
      .post(`/interno/usuarios/${alta.id}/contrasena-temporal`)
      .set(...conServicio());

    expect(reemision.status).toBe(200);
    expect(reemision.body.contrasena_temporal).not.toBe(primera);
    expect(reemision.body.usuario.debe_cambiar_contrasena).toBe(true);

    // La anterior deja de servir y la nueva entra marcada.
    expect((await iniciarSesion('reemitido@test.com', 'ElegidaPorMi1')).status).toBe(401);
    const conNueva = await iniciarSesion('reemitido@test.com', reemision.body.contrasena_temporal);
    expect(conNueva.body.usuario.debe_cambiar_contrasena).toBe(true);
  });

  test('guarda sólo el hash de la nueva temporal', async () => {
    const usuario = await Usuario.findOne({ where: { email: 'reemitido@test.com' } });
    expect(usuario!.contrasena.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('ElegidaPorMi1', usuario!.contrasena)).toBe(false);
  });

  test('exige credencial de servicio, como todo /interno', async () => {
    const respuesta = await request(app).post('/interno/usuarios/cualquiera/contrasena-temporal');
    expect(respuesta.status).toBe(401);
  });

  test('un usuario inexistente responde 404', async () => {
    const respuesta = await request(app)
      .post('/interno/usuarios/00000000-0000-4000-8000-000000000000/contrasena-temporal')
      .set(...conServicio());

    expect(respuesta.status).toBe(404);
  });
});
