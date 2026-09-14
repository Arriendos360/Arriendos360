/**
 * Idempotencia del consumidor: un evento repetido manda UN solo correo.
 *
 * ── ES LA PRUEBA MAS IMPORTANTE DEL SERVICIO ────────────────────────────────
 *
 * La entrega del bus es al-menos-una-vez POR DISEÑO, asi que la reentrega no es una
 * posibilidad remota sino una certeza: basta que otro suscriptor del mismo evento
 * rechace la entrega para que el publicador la repita a todos. Y aqui el efecto lo lee
 * una persona: no hay `UPDATE` que recoja un correo ya enviado.
 *
 * Es el tercer escalon de una escalada que el proyecto lleva anotada desde el paso 4.
 * `database/inmuebles/003` decia que poner un inmueble en `arrendado` dos veces no
 * hace daño «hoy»; `database/financiero/003`, que insertar una cuenta de cobro dos
 * veces factura el mismo mes dos veces. Este es el peor de los tres.
 */

import crypto from 'crypto';
import request from 'supertest';

import {
  app,
  cerrarEntorno,
  conServicio,
  entregarEvento,
  enviosDe,
  prepararEntorno,
  todosLosEnvios,
  usuarioDe,
} from './utiles/entorno';

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('Un evento repetido produce UN solo envío', () => {
  test('la segunda entrega del mismo id_evento no redacta nada', async () => {
    const idUsuario = usuarioDe({ email: 'repetido@test.com' });

    const primera = await entregarEvento('CuentaCobroGenerada', {
      id_cuenta_cobro: crypto.randomUUID(),
      id_contrato: crypto.randomUUID(),
      id_inquilino: idUsuario,
      valor: 1500000,
      inicio: '2026-06-01',
      fin: '2026-06-30',
    });

    expect(primera.respuesta.status).toBe(200);
    expect(primera.respuesta.body.repetido).toBe(false);
    expect(await enviosDe(primera.sobre.id_evento)).toHaveLength(1);

    // El MISMO sobre otra vez, que es exactamente lo que hace un reintento.
    const segunda = await entregarEvento(
      'CuentaCobroGenerada',
      primera.sobre.payload,
      primera.sobre,
    );

    // 200 y no error: el productor tiene que poder marcarlo entregado y olvidarse.
    expect(segunda.respuesta.status).toBe(200);
    expect(segunda.respuesta.body.repetido).toBe(true);

    // Y sigue habiendo UN envío, no dos.
    expect(await enviosDe(primera.sobre.id_evento)).toHaveLength(1);
  });

  test('diez reentregas siguen dejando un solo envío', async () => {
    // Una sola repetición podría pasar por casualidad —una carrera que no se dio—.
    // Diez seguidas, no.
    const idUsuario = usuarioDe();

    const { sobre } = await entregarEvento('ContrasenaTemporalEmitida', {
      id_usuario: idUsuario,
      motivo: 'ALTA',
    });

    for (let i = 0; i < 10; i += 1) {
      await entregarEvento('ContrasenaTemporalEmitida', sobre.payload, sobre);
    }

    expect(await enviosDe(sobre.id_evento)).toHaveLength(1);
  });

  test('un evento con DOS destinatarios repetido sigue dejando DOS envíos', async () => {
    // El caso que una idempotencia mal hecha rompe de la forma más fea: si la marca
    // del evento se pusiera entre los dos INSERT, la reentrega duplicaría uno de los
    // dos avisos y no el otro.
    const idInquilino = usuarioDe({ email: 'inq@test.com' });
    const idPropietario = usuarioDe({ email: 'prop@test.com' });

    const { sobre } = await entregarEvento('CuentaCobroEnMora', {
      id_cuenta_cobro: crypto.randomUUID(),
      id_contrato: crypto.randomUUID(),
      id_inquilino: idInquilino,
      id_propietario: idPropietario,
      valor: 900000,
      inicio: '2026-05-01',
      fin: '2026-05-31',
      dias_de_mora: 7,
      direccion_inmueble: 'Calle 1 #2-3',
    });

    expect(await enviosDe(sobre.id_evento)).toHaveLength(2);

    await entregarEvento('CuentaCobroEnMora', sobre.payload, sobre);
    await entregarEvento('CuentaCobroEnMora', sobre.payload, sobre);

    const envios = await enviosDe(sobre.id_evento);
    expect(envios).toHaveLength(2);
    expect(envios.map((e) => e.destinatario).sort()).toEqual(['inq@test.com', 'prop@test.com']);
  });

  test('dos eventos DISTINTOS con la misma carga sí producen dos envíos', async () => {
    // La contrapartida, y hace falta: si la idempotencia se decidiera por el contenido
    // en vez de por el `id_evento`, dos hechos iguales de verdad se tragarían el
    // segundo aviso.
    const idUsuario = usuarioDe();
    const carga = {
      id_cuenta_cobro: crypto.randomUUID(),
      id_contrato: crypto.randomUUID(),
      id_inquilino: idUsuario,
      valor: 100,
      inicio: '2026-07-01',
      fin: '2026-07-31',
    };

    const uno = await entregarEvento('CuentaCobroGenerada', carga);
    const dos = await entregarEvento('CuentaCobroGenerada', carga);

    expect(uno.sobre.id_evento).not.toBe(dos.sobre.id_evento);
    expect(await enviosDe(uno.sobre.id_evento)).toHaveLength(1);
    expect(await enviosDe(dos.sobre.id_evento)).toHaveLength(1);
  });
});

describe('La entrada exige credencial de servicio', () => {
  test('sin credencial responde 401 y no redacta nada', async () => {
    // Sin esta línea, cualquiera con acceso al puerto podría mandar un correo con el
    // remitente del sistema a la dirección de cualquier usuario cuyo UUID conociera.
    const antes = (await todosLosEnvios()).length;

    const respuesta = await request(app).post('/interno/eventos').send({
      id_evento: crypto.randomUUID(),
      tipo: 'ContrasenaTemporalEmitida',
      version: 1,
      ocurrido_en: new Date().toISOString(),
      payload: { id_usuario: crypto.randomUUID(), motivo: 'ALTA' },
    });

    expect(respuesta.status).toBe(401);
    expect(await todosLosEnvios()).toHaveLength(antes);
  });
});

describe('Un sobre mal formado se rechaza sin tocar la bitácora', () => {
  test('sin id_evento responde 400', async () => {
    const antes = (await todosLosEnvios()).length;

    const respuesta = await request(app)
      .post('/interno/eventos')
      .set(...conServicio())
      .send({ tipo: 'ContrasenaTemporalEmitida', version: 1, payload: {} });

    expect(respuesta.status).toBe(400);
    expect(await todosLosEnvios()).toHaveLength(antes);
  });

  test('una carga sin destinatario válido responde 500 para que el emisor lo vea', async () => {
    // 500 y no 200: la carga es responsabilidad del emisor, y el mecanismo ya sabe qué
    // hacer con un evento que falla siempre — lo aparta tras diez intentos y lo deja a
    // la vista en SU tabla de salida, que es donde tiene que verse un error del emisor.
    const { respuesta, sobre } = await entregarEvento('ContrasenaTemporalEmitida', {
      id_usuario: 'esto-no-es-un-uuid',
      motivo: 'ALTA',
    } as never);

    expect(respuesta.status).toBe(500);
    expect(await enviosDe(sobre.id_evento)).toHaveLength(0);
  });

  test('un tipo sin manejador se ignora con 200, no con error', async () => {
    // Coreografía: el productor no sabe quién escucha, así que un tipo sin manejador
    // significa que la suscripción sobra, no que la entrega haya fallado. Devolver
    // error ensuciaría la tabla de salida del emisor por una decisión de
    // configuración ajena.
    const respuesta = await request(app)
      .post('/interno/eventos')
      .set(...conServicio('ms-contratos'))
      .send({
        id_evento: crypto.randomUUID(),
        tipo: 'ContratoFinalizado',
        version: 1,
        ocurrido_en: new Date().toISOString(),
        payload: { id_contrato: crypto.randomUUID(), id_inmueble: crypto.randomUUID() },
      });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.ignorado).toBe(true);
  });
});
