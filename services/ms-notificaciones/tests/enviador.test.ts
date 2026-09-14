/**
 * El enviador: manda, marca, reintenta y aparta.
 *
 * ── LAS DOS COSAS QUE ESTA SUITE DEFIENDE ───────────────────────────────────
 *
 * 1. **Que el cuerpo se borre al enviar, en la misma sentencia que la marca.** El
 *    correo de recuperacion lleva un enlace con el token en claro, y conservarlo en la
 *    bitacora para siempre seria dejar la llave debajo del felpudo.
 *
 * 2. **Que ante la duda NO se reenvie.** Una fila que se queda en `enviando` porque el
 *    proceso murio con el mensaje en vuelo no se reintenta sola. Es la asimetria
 *    deliberada con el publicador del bus, y la unica forma de comprobarla es dejar una
 *    fila en ese estado a mano y ver que el barrido siguiente la ignora.
 *
 * Nada de temporizadores: se llama a `ciclo()` a mano, como hacen las suites del
 * gateway con `entregarEventos()`.
 */

import crypto from 'crypto';

import {
  Envio,
  cerrarEntorno,
  entregarEvento,
  enviosDe,
  prepararEntorno,
  usuarioDe,
} from './utiles/entorno';
import { crearEnviador } from '../src/services/enviador';
import {
  ENVIO_APARTADO,
  ENVIO_ENVIADO,
  ENVIO_ENVIANDO,
  ENVIO_PENDIENTE,
} from '../src/models/constantes';

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

/** Deja un envío pendiente en la bitácora por el camino de verdad: un evento. */
const unEnvioPendiente = async (email = 'destino@test.com'): Promise<Envio> => {
  const idUsuario = usuarioDe({ email });

  const { sobre } = await entregarEvento('RecuperacionSolicitada', {
    id_usuario: idUsuario,
    token: crypto.randomBytes(32).toString('hex'),
    expira_en: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });

  const [envio] = await enviosDe(sobre.id_evento);
  return envio as Envio;
};

/** Un enviador con las esperas a cero: lo que estorba de un reintento es el reloj. */
const enviadorDe = (
  enviar: (destinatario: string, asunto: string, html: string) => Promise<{ messageId: string }>,
  opciones: { maxIntentos?: number } = {},
) =>
  crearEnviador({
    enviar,
    esperaBaseMs: 0,
    esperaMaximaMs: 0,
    registrar: () => undefined,
    ...opciones,
  });

describe('Envío correcto', () => {
  test('manda, marca enviado y BORRA el cuerpo', async () => {
    const envio = await unEnvioPendiente('ok@test.com');
    const mandados: Array<{ a: string; asunto: string; html: string }> = [];

    const resultado = await enviadorDe(async (a, asunto, html) => {
      mandados.push({ a, asunto, html });
      return { messageId: 'x' };
    }).ciclo();

    expect(resultado.enviados).toBe(1);
    expect(mandados).toHaveLength(1);
    expect(mandados[0]!.a).toBe('ok@test.com');
    // El cuerpo SÍ llegó al transporte: el borrado es posterior, no en vez de.
    expect(mandados[0]!.html).toContain('/restablecer?token=');

    const despues = await Envio.findByPk(envio.id_envio);
    expect(despues!.estado).toBe(ENVIO_ENVIADO);
    expect(despues!.enviado_en).not.toBeNull();
    expect(despues!.intentos).toBe(1);

    // Y el cuerpo ya no está. Lo que queda es la bitácora de verdad: a quién, cuándo,
    // con qué asunto y que funcionó.
    expect(despues!.cuerpo).toBeNull();
    expect(despues!.asunto).toBe('Restablece tu contraseña de Arriendos360');
    expect(despues!.destinatario).toBe('ok@test.com');
  });

  test('un envío ya enviado no se vuelve a mandar', async () => {
    // El barrido siguiente no puede repetir lo que ya salió.
    let veces = 0;
    await enviadorDe(async () => {
      veces += 1;
      return { messageId: 'x' };
    }).ciclo();

    expect(veces).toBe(0);
  });
});

describe('Fallo conocido: vuelve a la cola', () => {
  test('anota el error, cuenta el intento y deja la fila pendiente', async () => {
    const envio = await unEnvioPendiente('falla@test.com');

    const resultado = await enviadorDe(async () => {
      throw new Error('SMTP dijo no');
    }).ciclo();

    expect(resultado.fallidos).toBe(1);

    const despues = await Envio.findByPk(envio.id_envio);
    // `pendiente` y no un estado `fallido` aparte: un fallo conocido se sabe que no
    // salió, así que se reintenta con normalidad. Lo que lo distingue de una fila nueva
    // es `intentos` y su `ultimo_error`.
    expect(despues!.estado).toBe(ENVIO_PENDIENTE);
    expect(despues!.intentos).toBe(1);
    expect(despues!.ultimo_error).toContain('SMTP dijo no');
    // Y el cuerpo NO se borra: hace falta para el reintento.
    expect(despues!.cuerpo).not.toBeNull();
  });

  test('el reintento siguiente sí lo manda', async () => {
    const envio = await Envio.findOne({
      where: { destinatario: 'falla@test.com' },
    });

    await enviadorDe(async () => ({ messageId: 'x' })).ciclo();

    const despues = await Envio.findByPk(envio!.id_envio);
    expect(despues!.estado).toBe(ENVIO_ENVIADO);
    expect(despues!.intentos).toBe(2);
    expect(despues!.ultimo_error).toBeNull();
    expect(despues!.cuerpo).toBeNull();
  });

  test('tras agotar los intentos se APARTA, no se borra', async () => {
    const envio = await unEnvioPendiente('apartado@test.com');
    const enviador = enviadorDe(async () => {
      throw new Error('rechazo permanente');
    }, { maxIntentos: 3 });

    await enviador.ciclo();
    await enviador.ciclo();
    const ultimo = await enviador.ciclo();

    expect(ultimo.apartados).toBe(1);

    const despues = await Envio.findByPk(envio.id_envio);
    expect(despues!.estado).toBe(ENVIO_APARTADO);
    expect(despues!.intentos).toBe(3);
    expect(despues!.ultimo_error).toContain('rechazo permanente');

    // Se aparta, no se borra: la fila es la única constancia de que a alguien no le
    // llegó su aviso.
    expect(despues).not.toBeNull();
  });

  test('un apartado deja de intentarse', async () => {
    let veces = 0;
    await enviadorDe(async () => {
      veces += 1;
      return { messageId: 'x' };
    }).ciclo();

    expect(veces).toBe(0);
  });
});

describe('Ante la duda, NO se reenvía', () => {
  test('una fila que quedó en «enviando» no se reintenta sola', async () => {
    // Es la asimetría deliberada con el publicador del bus. Los dos estados posibles
    // tras un corte son «salió y no se anotó» y «no salió», y no se distinguen desde
    // aquí. Reintentar convierte el primero en un correo duplicado —imposible de
    // deshacer, y si llevaba un enlace de recuperación, un segundo enlace vivo en un
    // buzón—; no reintentar convierte el segundo en un aviso que no salió y que se ve
    // en una consulta. De los dos daños, el reparable es el segundo.
    const envio = await unEnvioPendiente('en-vuelo@test.com');

    // Se simula el corte: la fila quedó tomada y el proceso murió.
    await Envio.update({ estado: ENVIO_ENVIANDO }, { where: { id_envio: envio.id_envio } });

    let veces = 0;
    const resultado = await enviadorDe(async () => {
      veces += 1;
      return { messageId: 'x' };
    }).ciclo();

    expect(veces).toBe(0);
    expect(resultado.enviados).toBe(0);

    // Sigue ahí, y sigue visible. No se reintenta, pero tampoco desaparece.
    const despues = await Envio.findByPk(envio.id_envio);
    expect(despues!.estado).toBe(ENVIO_ENVIANDO);
    expect(despues!.cuerpo).not.toBeNull();
  });

  test('dos barridos solapados no mandan el mismo correo dos veces', async () => {
    // La toma es un UPDATE condicionado al estado, así que el segundo barrido encuentra
    // la fila ya tomada y la salta. Sin eso, dos ciclos concurrentes —o dos réplicas—
    // mandarían el mismo correo dos veces.
    await unEnvioPendiente('solapado@test.com');

    const mandados: string[] = [];
    const lento = enviadorDe(async (a) => {
      // Cede el turno dentro del envío, que es donde se solaparían de verdad.
      await new Promise((r) => setImmediate(r));
      mandados.push(a);
      return { messageId: 'x' };
    });

    await Promise.all([lento.ciclo(), lento.ciclo()]);

    expect(mandados.filter((a) => a === 'solapado@test.com')).toHaveLength(1);
  });
});

describe('Un envío sin cuerpo no se manda vacío', () => {
  test('se trata como fallo antes de llamar al transporte', async () => {
    // Un correo en blanco ya enviado no se puede retirar, y es peor que uno que no
    // sale. Así que se comprueba ANTES de mandar.
    const envio = await unEnvioPendiente('sin-cuerpo@test.com');
    await Envio.update({ cuerpo: null }, { where: { id_envio: envio.id_envio } });

    let veces = 0;
    const resultado = await enviadorDe(async () => {
      veces += 1;
      return { messageId: 'x' };
    }).ciclo();

    expect(veces).toBe(0);
    expect(resultado.fallidos).toBe(1);

    const despues = await Envio.findByPk(envio.id_envio);
    expect(despues!.ultimo_error).toContain('no tiene cuerpo');
  });
});
