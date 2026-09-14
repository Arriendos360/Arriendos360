/**
 * Recuperación de contraseña.
 *
 * Lo que se fija: que `/recuperar` no delate qué correos existen, que el enlace
 * sea de un solo uso y caduque, y que al restablecer caigan todas las sesiones
 * abiertas — que es el motivo por el que alguien restablece su contraseña.
 *
 * ── EL PASO 7 CAMBIA DE DÓNDE SE LEE EL TOKEN ───────────────────────────────
 *
 * Antes se leía de un `NotificadorNulo`, un buzón falso que guardaba lo que el servicio
 * había redactado. Ese buzón ya no existe: este servicio no manda correos, anota
 * `RecuperacionSolicitada` en su tabla de salida y es ms-notificaciones quien avisa.
 *
 * Así que el token se lee de `identidad.eventos_salida`, y eso no es sólo una
 * adaptación: es una prueba mejor. El buzón comprobaba un texto interno; la tabla de
 * salida comprueba **lo que de verdad sale por el bus**, que es lo único que otro
 * servicio va a ver. Si el evento se emitiera sin el token, o con el hash en vez del
 * token, el buzón no lo habría notado y esto sí.
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
  entregarEventos,
  eventosDeSalida,
  iniciarSesion,
  levantarDobleNotificaciones,
  recrearBase,
  registrarPropietario,
  type DobleNotificaciones,
  type Sesion,
} from './utiles/entorno';
import { TokenRecuperacion } from '../src/models/TokenRecuperacion';
import { Usuario } from '../src/models/Usuario';
import { VIGENCIA_MINUTOS, hashDeToken } from '../src/services/recuperacion';
import { tokenInvalidado } from '../src/services/tokenService';

let propietario: Sesion;

/**
 * El token que viajó en el último `RecuperacionSolicitada`.
 *
 * Sale del sobre, no de un correo: el enlace lo arma ms-notificaciones con su propia
 * `URL_APP`, porque armar una URL es cosa del canal.
 */
const tokenDelUltimoEvento = async (): Promise<string> => {
  const eventos = await eventosDeSalida('RecuperacionSolicitada');
  const ultimo = eventos[eventos.length - 1];
  return (ultimo?.payload['token'] as string) ?? '';
};

/** Cuántos `RecuperacionSolicitada` se han emitido. */
const recuperacionesEmitidas = async (): Promise<number> =>
  (await eventosDeSalida('RecuperacionSolicitada')).length;

beforeAll(async () => {
  await recrearBase();

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

  test('el mensaje promete un envío FUTURO, no uno ya hecho', async () => {
    // ── ESTA PRUEBA ES DEL PASO 7, Y NO ES COSMÉTICA ───────────────────────
    //
    // Antes el correo salía DENTRO de esta petición, así que al responder ya se sabía
    // si había salido y «recibirás un enlace» era una afirmación sostenible. Ahora
    // esto sólo anota el evento; el correo lo manda ms-notificaciones después.
    //
    // La diferencia entre «te enviaremos» y «recibirás» deja de ser redacción: la
    // segunda afirma un hecho consumado que este endpoint ya no puede afirmar. Lo que
    // sí garantiza —que el aviso está anotado y va a salir— es lo que dice la primera.
    const respuesta = await request(app)
      .post('/api/auth/recuperar')
      .send({ email: 'olvidadizo@test.com' });

    expect(respuesta.body.mensaje).toMatch(/te enviaremos/i);
    expect(respuesta.body.mensaje).not.toMatch(/recibirás/i);
  });

  test('sólo emite el evento si la cuenta existe', async () => {
    const antes = await recuperacionesEmitidas();

    await request(app).post('/api/auth/recuperar').send({ email: 'nadie@test.com' });
    expect(await recuperacionesEmitidas()).toBe(antes);

    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });
    expect(await recuperacionesEmitidas()).toBe(antes + 1);
  });

  test('el evento lleva el token en claro, el usuario y la caducidad', async () => {
    // El sobre NO lleva el enlace ni la dirección de correo. El enlace lo arma el canal
    // con su propia URL_APP; la dirección la resuelve ms-notificaciones preguntando,
    // porque un correo pertenece a identidad.usuarios y a nadie más.
    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });

    const eventos = await eventosDeSalida('RecuperacionSolicitada');
    const ultimo = eventos[eventos.length - 1]!;

    expect(ultimo.payload['id_usuario']).toBe(propietario.id);
    expect(ultimo.payload['token']).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof ultimo.payload['expira_en']).toBe('string');

    // Ni correo ni enlace en el sobre.
    expect(ultimo.payload['email']).toBeUndefined();
    expect(ultimo.payload['enlace']).toBeUndefined();
    expect(JSON.stringify(ultimo.payload)).not.toContain('olvidadizo@test.com');

    // Y ordena por usuario: dos recuperaciones seguidas de la misma persona tienen que
    // entregarse en orden, porque la segunda invalida el enlace de la primera.
    expect(ultimo.clave_orden).toBe(propietario.id);
  });

  test('el token se guarda hasheado, nunca en claro', async () => {
    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });
    const token = await tokenDelUltimoEvento();

    expect(await TokenRecuperacion.findOne({ where: { hash_token: token } })).toBeNull();
    expect(
      await TokenRecuperacion.findOne({ where: { hash_token: hashDeToken(token) } }),
    ).not.toBeNull();
  });

  test('cada evento emitido tiene su token guardado: van en la misma transacción', async () => {
    // Si el token se guardara y el evento no, habría un enlace vivo que nadie recibe;
    // si el evento se anotara y el token no, llegaría un correo con un enlace que no
    // existe. Lo comprobable sin inyectar un fallo es la correspondencia: por cada
    // evento emitido hay un token guardado con ese hash.
    const eventos = await eventosDeSalida('RecuperacionSolicitada');
    expect(eventos.length).toBeGreaterThan(0);

    for (const evento of eventos) {
      // Los ya entregados tienen el payload borrado a propósito; ésos no se comprueban.
      const token = evento.payload['token'] as string | undefined;
      if (!token) {
        continue;
      }

      const hash = hashDeToken(token);
      expect(await TokenRecuperacion.findOne({ where: { hash_token: hash } })).not.toBeNull();
    }
  });

  test('pedirlo otra vez invalida el enlace anterior', async () => {
    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });
    const viejo = await tokenDelUltimoEvento();

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
    await request(app).post('/api/auth/recuperar').send({ email });
    return tokenDelUltimoEvento();
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

    await request(app).post('/api/auth/recuperar').send({ email: 'sesiones@test.com' });
    const token = await tokenDelUltimoEvento();

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

    await request(app).post('/api/auth/recuperar').send({ email: 'sesiones2@test.com' });
    await request(app)
      .post('/api/auth/restablecer')
      .send({ token: await tokenDelUltimoEvento(), contrasena_nueva: 'YaNoVale1234' });

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

    await request(app).post('/api/auth/recuperar').send({ email: 'entra-rapido@test.com' });
    await request(app)
      .post('/api/auth/restablecer')
      .send({ token: await tokenDelUltimoEvento(), contrasena_nueva: 'RecienPuesta1' });

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

describe('El payload del token se BORRA al entregarlo', () => {
  /**
   * ── LA PRUEBA QUE SOSTIENE LA CONDICIÓN DEL ADR 0019 ──────────────────────
   *
   * `identidad.tokens_recuperacion` guarda sólo el SHA-256 del token, para que leer esa
   * tabla no permita restablecer la contraseña de nadie. El evento rompe a medias esa
   * propiedad, porque el token viaja en claro en `eventos_salida.payload`.
   *
   * Se acota borrando el payload al marcar la fila como entregada, y en la MISMA
   * sentencia: si fueran dos operaciones, una caída entre ellas dejaría el token legible
   * indefinidamente. Aquí se comprueba el resultado — entregado y sin carga.
   */
  let notificaciones: DobleNotificaciones;

  beforeAll(async () => {
    notificaciones = await levantarDobleNotificaciones();
    process.env['MS_NOTIFICACIONES_URL'] = notificaciones.url;
  });

  afterAll(async () => {
    delete process.env['MS_NOTIFICACIONES_URL'];
    await notificaciones.cerrar();
  });

  test('el suscriptor SÍ recibe el token, y la tabla se queda sin él', async () => {
    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });
    const token = await tokenDelUltimoEvento();
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    await entregarEventos();

    // Al consumidor le llegó el token: el borrado es POSTERIOR a la entrega, no en vez
    // de ella. Sin esto el correo saldría sin enlace, que es peor que no salir.
    const recibido = notificaciones.recibidos.find((e) => e.payload?.['token'] === token);
    expect(recibido).toBeDefined();

    // Y en la tabla ya no queda.
    const eventos = await eventosDeSalida('RecuperacionSolicitada');
    const entregado = eventos.find((e) => e.id_evento === recibido!.id_evento)!;

    expect(entregado.estado).toBe('entregado');
    expect(entregado.payload).toEqual({});
    expect(JSON.stringify(entregado.payload)).not.toContain(token);
  });

  test('un evento SIN entregar sí conserva su token: sólo se borra al entregar', async () => {
    // La contrapartida, y hace falta: si el payload se borrara antes de tiempo, el correo
    // saldría sin enlace y nadie podría restablecer nada.
    notificaciones.caer(503);
    await request(app).post('/api/auth/recuperar').send({ email: 'olvidadizo@test.com' });

    await entregarEventos();
    notificaciones.levantar();

    const eventos = await eventosDeSalida('RecuperacionSolicitada');
    const pendiente = eventos.find((e) => e.estado === 'pendiente')!;

    expect(pendiente).toBeDefined();
    expect(pendiente.payload['token']).toMatch(/^[a-f0-9]{64}$/);
    expect(pendiente.intentos).toBeGreaterThan(0);
  });

  test('ContrasenaTemporalEmitida NO se redacta: no lleva secretos', async () => {
    // Sólo un id_usuario y un motivo. Redactarlo también habría sido perder la única
    // constancia de por qué se avisó a alguien, sin ganar nada a cambio.
    const sesion = await iniciarSesion('olvidadizo@test.com', 'PrimeraVez123');

    const alta = await crearInquilino(sesion.body.token, {
      nombres: 'Aviso',
      apellidos: 'Temporal',
      email: 'aviso-temporal@test.com',
      documento: '80000010',
    });
    expect(alta.respuesta.status).toBe(201);

    await entregarEventos();

    const eventos = await eventosDeSalida('ContrasenaTemporalEmitida');
    const suyo = eventos.find((e) => e.payload['id_usuario'] === alta.id);

    expect(suyo).toBeDefined();
    expect(suyo!.estado).toBe('entregado');
    expect(suyo!.payload['motivo']).toBe('ALTA');

    // Y la contraseña temporal NO está en el sobre. El ADR 0007 sigue en pie: se entrega
    // en mano, y este evento sólo avisa de que la cuenta existe.
    expect(JSON.stringify(suyo!.payload)).not.toContain(
      alta.respuesta.body.contrasena_temporal,
    );
  });

  test('la reemisión emite el evento con motivo REEMISION', async () => {
    const usuario = await Usuario.findOne({ where: { email: 'aviso-temporal@test.com' } });

    const reemision = await request(app)
      .post(`/interno/usuarios/${usuario!.id_usuario}/contrasena-temporal`)
      .set(...conServicio());
    expect(reemision.status).toBe(200);

    const eventos = await eventosDeSalida('ContrasenaTemporalEmitida');
    const suyos = eventos.filter((e) => e.payload['id_usuario'] === usuario!.id_usuario);

    // Dos hechos distintos sobre la misma persona: el alta y la reemisión.
    expect(suyos.map((e) => e.payload['motivo'])).toEqual(['ALTA', 'REEMISION']);

    // Y tampoco lleva la contraseña nueva.
    expect(JSON.stringify(suyos[1]!.payload)).not.toContain(reemision.body.contrasena_temporal);
  });
});
