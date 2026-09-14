/**
 * Si ms-identidad no responde, el evento NO se pierde.
 *
 * ── LA GARANTIA QUE SE DEFIENDE ─────────────────────────────────────────────
 *
 * Este servicio necesita a ms-identidad para saber a donde mandar un correo. Si no
 * contesta, hay dos formas de reaccionar y solo una es aceptable:
 *
 *   * DEGRADAR —dar el evento por procesado y no mandar nada— pierde el aviso para
 *     siempre. Con la marca del `id_evento` ya puesta, el productor lo tiene por
 *     entregado y no vuelve a intentarlo. Nadie se entera nunca.
 *
 *   * PROPAGAR hace que la transaccion del consumidor se vaya entera, marca del evento
 *     incluida, y que la respuesta sea 500. El productor lo reintenta con su espera
 *     creciente, y tras diez intentos lo aparta y lo deja a la vista. El aviso llega
 *     tarde o se ve que no llego.
 *
 * Es justo lo contrario de lo que hace el cliente equivalente de ms-financiero, y la
 * diferencia es la correcta: alli quien preguntaba era el motor, cuyo trabajo es
 * facturar, y un barrido que factura sin mandar el correo es mejor que uno que no
 * factura. Aqui el correo ES el trabajo.
 */

import crypto from 'crypto';

import {
  cerrarEntorno,
  entregarEvento,
  enviosDe,
  identidadFalsa,
  prepararEntorno,
  usuarioDe,
} from './utiles/entorno';

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

const recuperacion = (idUsuario: string) => ({
  id_usuario: idUsuario,
  token: 'a'.repeat(64),
  expira_en: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
});

describe('ms-identidad caído', () => {
  test('responde 500 y no deja nada escrito', async () => {
    const idUsuario = usuarioDe();

    identidadFalsa().caer(503);
    const { respuesta, sobre } = await entregarEvento(
      'RecuperacionSolicitada',
      recuperacion(idUsuario),
    );
    identidadFalsa().levantar();

    // 500 es la señal que hace que el productor reintente.
    expect(respuesta.status).toBe(500);
    // Y nada quedó escrito: ni el envío ni la marca del evento.
    expect(await enviosDe(sobre.id_evento)).toHaveLength(0);
  });

  test('el MISMO evento, reintentado después, sí se procesa', async () => {
    // Es la mitad que de verdad importa: que la transacción se fuera entera significa
    // que la marca del `id_evento` tampoco quedó, así que la reentrega NO se descarta
    // como repetida. Si el 500 hubiera dejado la marca puesta, este segundo intento
    // respondería «ya procesado» y el aviso se perdería en silencio.
    const idUsuario = usuarioDe({ email: 'reintentado@test.com' });

    identidadFalsa().caer(503);
    const fallido = await entregarEvento('RecuperacionSolicitada', recuperacion(idUsuario));
    expect(fallido.respuesta.status).toBe(500);
    identidadFalsa().levantar();

    // El MISMO sobre, con el mismo `id_evento`, que es lo que entrega el publicador.
    const reintento = await entregarEvento(
      'RecuperacionSolicitada',
      fallido.sobre.payload,
      fallido.sobre,
    );

    expect(reintento.respuesta.status).toBe(200);
    expect(reintento.respuesta.body.repetido).toBe(false);

    const envios = await enviosDe(fallido.sobre.id_evento);
    expect(envios).toHaveLength(1);
    expect(envios[0]!.destinatario).toBe('reintentado@test.com');
  });

  test('un evento con dos destinatarios tampoco deja la mitad escrita', async () => {
    // La atomicidad tiene que cubrir los dos envíos: si el primero se escribiera y el
    // segundo fallara, el reintento mandaría dos veces el primero.
    const idInquilino = usuarioDe();
    const idPropietario = usuarioDe();

    identidadFalsa().caer(500);
    const { respuesta, sobre } = await entregarEvento('CuentaCobroEnMora', {
      id_cuenta_cobro: crypto.randomUUID(),
      id_contrato: crypto.randomUUID(),
      id_inquilino: idInquilino,
      id_propietario: idPropietario,
      valor: 700000,
      inicio: '2026-01-01',
      fin: '2026-01-31',
      dias_de_mora: 8,
      direccion_inmueble: 'Carrera 7 #8-9',
    });
    identidadFalsa().levantar();

    expect(respuesta.status).toBe(500);
    expect(await enviosDe(sobre.id_evento)).toHaveLength(0);

    // Y al reintentarlo salen los DOS, no uno.
    const reintento = await entregarEvento('CuentaCobroEnMora', sobre.payload, sobre);
    expect(reintento.respuesta.status).toBe(200);
    expect(await enviosDe(sobre.id_evento)).toHaveLength(2);
  });
});

describe('Sin MS_IDENTIDAD_URL configurada', () => {
  test('también responde 500, en vez de dar el aviso por hecho', async () => {
    // El caso de una variable de entorno que falta. Es tentador tratarlo como «no hay
    // a quién avisar» y devolver 200; sería perder todos los avisos del sistema sin un
    // solo error en ninguna parte, que es la clase de fallo que este proyecto trata con
    // más cuidado.
    const idUsuario = usuarioDe();
    const guardada = process.env['MS_IDENTIDAD_URL'];
    delete process.env['MS_IDENTIDAD_URL'];

    const { respuesta, sobre } = await entregarEvento(
      'RecuperacionSolicitada',
      recuperacion(idUsuario),
    );

    process.env['MS_IDENTIDAD_URL'] = guardada;

    expect(respuesta.status).toBe(500);
    expect(await enviosDe(sobre.id_evento)).toHaveLength(0);
  });
});
