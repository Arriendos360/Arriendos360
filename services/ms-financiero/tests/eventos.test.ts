/**
 * El consumidor del bus: la primera cuenta de cobro nace de un evento.
 *
 * Es el caso que el Capitulo 2 especifica textualmente —«MS-Financiero consume
 * el evento, extrae `id_contrato`, `canon` y `fecha_inicio_corte`, e inserta la
 * primera Cuenta_cobro»— y esta suite es lo que demuestra que ocurre.
 *
 * ── LA PRUEBA QUE NO PUEDE FALTAR ES LA SEGUNDA ────────────────────────────
 *
 * «Recibirlo dos veces no crea dos cuentas.» La entrega del bus es
 * al-menos-una-vez, asi que la reentrega no es una posibilidad remota: es una
 * certeza, y desde el paso 6e hay ademas un segundo suscriptor —si ms-inmuebles
 * falla, el evento se reintenta a los DOS y este servicio lo recibe otra vez.
 * Sin idempotencia eso es facturarle al inquilino el mismo mes dos veces.
 *
 * `database/inmuebles/003` lo anticipo con estas palabras: «poner un inmueble en
 * arrendado dos veces no hace daño, es cierto — hoy. Deja de serlo en cuanto un
 * consumidor tenga que INSERTAR algo, que es exactamente lo que hara
 * ms-financiero en el paso 6 con la primera cuenta de cobro».
 *
 * ── Y SE ENTREGA POR HTTP, NO LLAMANDO AL MANEJADOR ────────────────────────
 *
 * `entregarEvento()` hace un POST de verdad a `/interno/eventos` con credencial
 * de servicio. Llamar al manejador directamente probaria la mitad: no la
 * credencial, no la validacion del sobre, y sobre todo no la idempotencia, que
 * vive en `crearConsumidor` y no en el manejador.
 *
 * Sin temporizadores: la entrega ocurre cuando la prueba la pide.
 */

import request from 'supertest';
import { TIPO_CONTRATO_FINALIZADO, TIPO_CONTRATO_FORMALIZADO } from 'arriendos360-shared';

import { CuentaCobro } from '../src/models/CuentaCobro';
import { ESTADO_CUENTA_PENDIENTE, USUARIO_SISTEMA } from '../src/models/constantes';
import {
  app,
  cerrarEntorno,
  conServicio,
  entregarEvento,
  escenario,
  eventosDeSalida,
  prepararEntorno,
} from './utiles/entorno';

// `beforeAll` y no `beforeEach`: la conexion a PostgreSQL es del proceso, asi
// que cerrarla entre pruebas dejaria a las siguientes sin base. Cada caso se
// aisla por datos, no por esquema — `escenario()` genera identificadores nuevos.
beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

/** Las cuentas de cobro de un contrato, ordenadas por periodo. */
const cuentasDe = (idContrato: string) =>
  CuentaCobro.findAll({ where: { id_contrato: idContrato }, order: [['inicio', 'ASC']] });

describe('ContratoFormalizado crea la primera cuenta de cobro', () => {
  test('con el id_contrato, el canon y la fecha_inicio_corte del evento', async () => {
    const { idContrato, idInmueble } = escenario();

    const { respuesta } = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1500000,
      fecha_inicio_corte: '2026-03-15',
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.repetido).toBe(false);

    const cuentas = await cuentasDe(idContrato);
    expect(cuentas).toHaveLength(1);

    const cuenta = cuentas[0]!;

    // Los TRES campos del evento, y ninguno derivado de otra cosa.
    expect(cuenta.id_contrato).toBe(idContrato);
    expect(parseFloat(String(cuenta.valor))).toBe(1500000);
    expect(cuenta.inicio).toBe('2026-03-15');

    // El periodo tesela: `fin` es la vispera del siguiente corte, no «un mes
    // menos un dia».
    expect(cuenta.fin).toBe('2026-04-14');
    expect(cuenta.estado).toBe(ESTADO_CUENTA_PENDIENTE);
  });

  test('la auditoria la registra a nombre del SISTEMA, no de quien firmo', async () => {
    // El sobre no lleva actor, y no se le inventa uno. El rastro no se pierde:
    // quien firmo esta en `contratos.contratos.creado_por`, y el evento es el
    // eslabon que une las dos filas. Ver docs/adr/0011.
    const { idContrato, idInmueble } = escenario();

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 800000,
      fecha_inicio_corte: '2026-01-01',
    });

    const [cuenta] = await cuentasDe(idContrato);
    expect(cuenta!.creado_por).toBe(USUARIO_SISTEMA);
    expect(cuenta!.actualizado_por).toBe(USUARIO_SISTEMA);
  });

  test('el dia 31 se recorta al ultimo dia del mes que no lo tiene', async () => {
    // La regla del dia 31, aplicada por el consumidor con la MISMA funcion que
    // usa el motor. Un corte el 31 de enero factura hasta la vispera del corte
    // de febrero, que es el 28.
    const { idContrato, idInmueble } = escenario();

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: '2026-01-31',
    });

    const [cuenta] = await cuentasDe(idContrato);
    expect(cuenta!.inicio).toBe('2026-01-31');
    expect(cuenta!.fin).toBe('2026-02-27');
  });
});

describe('Idempotencia: recibirlo dos veces no cobra dos veces', () => {
  test('la reentrega del MISMO id_evento no crea una segunda cuenta', async () => {
    const { idContrato, idInmueble } = escenario();

    const carga = {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1200000,
      fecha_inicio_corte: '2026-05-01',
    };

    const primera = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, carga);
    expect(primera.respuesta.body.repetido).toBe(false);

    // El MISMO sobre otra vez, que es exactamente lo que hace el publicador
    // cuando el otro suscriptor falla y reintenta la fila.
    const segunda = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, carga, primera.sobre);

    // 200 y no un error: para el productor esto es entregado, y tiene que poder
    // marcarlo y olvidarse.
    expect(segunda.respuesta.statusCode).toBe(200);
    expect(segunda.respuesta.body.repetido).toBe(true);

    // LA aserción de la suite.
    expect(await cuentasDe(idContrato)).toHaveLength(1);
  });

  test('tres reentregas seguidas siguen dejando una sola cuenta', async () => {
    const { idContrato, idInmueble } = escenario();

    const carga = {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 500000,
      fecha_inicio_corte: '2026-02-10',
    };

    const { sobre } = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, carga);
    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, carga, sobre);
    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, carga, sobre);

    expect(await cuentasDe(idContrato)).toHaveLength(1);
  });

  test('dos eventos DISTINTOS del mismo contrato si son dos cosas', async () => {
    // La otra cara: la idempotencia descarta por `id_evento`, no por contrato.
    // Dos sobres distintos son dos hechos distintos, y si el segundo trae otro
    // periodo tiene que entrar. Sin esta prueba, un consumidor que descartara
    // por `id_contrato` pasaria la anterior y romperia la facturacion.
    const { idContrato, idInmueble } = escenario();

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: '2026-01-01',
    });

    const segundo = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: '2026-02-01',
    });

    expect(segundo.respuesta.body.repetido).toBe(false);
    expect(await cuentasDe(idContrato)).toHaveLength(2);
  });

  test('y el indice unico impide el duplicado aunque el evento sea otro', async () => {
    // La SEGUNDA red, y no sustituye a la primera. La bitacora evita que el
    // intento se produzca; el indice `(id_contrato, inicio)` evita el duplicado
    // aunque alguien se salte la bitacora. Dos sobres distintos con el mismo
    // periodo son un cobro duplicado, y la base lo rechaza.
    const { idContrato, idInmueble } = escenario();

    const carga = {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: '2026-07-01',
    };

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, carga);

    // Sobre nuevo, mismo periodo: la bitacora no lo reconoce y el manejador
    // intenta insertar. El 500 es lo correcto — nada quedo escrito y el
    // productor lo reintentara hasta apartarlo, que es donde tiene que verse.
    const repetido = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, carga);

    expect(repetido.respuesta.statusCode).toBe(500);
    expect(await cuentasDe(idContrato)).toHaveLength(1);
  });
});

describe('Lo que el consumidor NO hace', () => {
  test('ContratoFinalizado se ignora: finalizar no cancela lo que se debe', async () => {
    // No es un olvido. Un inquilino que se va debiendo dos meses los sigue
    // debiendo, y borrarle la deuda al firmar la salida seria un fallo contable.
    // Lo que si pasa es que dejan de generarse cuentas nuevas, y eso ya ocurre
    // solo porque el motor barre los contratos `activo`.
    const { idContrato, idInmueble } = escenario();

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: '2026-01-01',
    });

    const { respuesta } = await entregarEvento(TIPO_CONTRATO_FINALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
    });

    // 200 y `ignorado`, no un error: en una coreografia un tipo sin manejador
    // significa que la suscripcion sobra, no que la entrega haya fallado.
    // Devolver error haria que el productor lo reintentara hasta apartarlo.
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.ignorado).toBe(true);

    // Y la cuenta de cobro sigue ahi.
    expect(await cuentasDe(idContrato)).toHaveLength(1);
  });
});

describe('Confianza cero sobre lo que llega por el bus', () => {
  test('sin credencial de servicio no se entrega nada', async () => {
    // Sin esto, cualquiera con acceso al puerto podria facturarle un canon a
    // quien quisiera inventandose un sobre.
    const { idContrato, idInmueble } = escenario();

    const respuesta = await request(app)
      .post('/interno/eventos')
      .send({
        id_evento: '11111111-1111-4111-8111-111111111111',
        tipo: TIPO_CONTRATO_FORMALIZADO,
        version: 1,
        ocurrido_en: new Date().toISOString(),
        payload: { id_contrato: idContrato, id_inmueble: idInmueble, canon: 1, fecha_inicio_corte: '2026-01-01' },
      });

    expect(respuesta.statusCode).toBe(401);
    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('un sobre sin forma de sobre se rechaza con 400', async () => {
    const respuesta = await request(app)
      .post('/interno/eventos')
      .set(...conServicio('ms-contratos'))
      .send({ tipo: TIPO_CONTRATO_FORMALIZADO });

    expect(respuesta.statusCode).toBe(400);
  });

  test('una carga sin canon valido falla y no deja media cuenta', async () => {
    // Que lo entregue otro servicio con credencial valida no hace confiable lo
    // que hay dentro (regla dura 7). Un canon ausente acabaria en una cuenta con
    // `valor` nulo que revienta en la base con un mensaje que no menciona el
    // evento; asi revienta antes y diciendo cual es.
    const { idContrato, idInmueble } = escenario();

    const { respuesta } = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 0,
      fecha_inicio_corte: '2026-01-01',
    });

    expect(respuesta.statusCode).toBe(500);
    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('una carga sin fecha_inicio_corte tampoco pasa', async () => {
    const { idContrato, idInmueble } = escenario();

    const { respuesta } = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: '',
    } as never);

    expect(respuesta.statusCode).toBe(500);
    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('el fallo del manejador no deja la marca de procesado', async () => {
    // Es la propiedad que hace que el reintento sirva de algo: la anotacion y el
    // efecto van en la misma transaccion, asi que un manejador que falla no deja
    // el evento «ya procesado» y sin cuenta de cobro. Se comprueba entregando
    // una carga mala y despues la buena, con el MISMO id_evento.
    const { idContrato, idInmueble } = escenario();

    const mala = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: -5,
      fecha_inicio_corte: '2026-01-01',
    });
    expect(mala.respuesta.statusCode).toBe(500);

    // El productor reintenta el mismo sobre. Si la marca hubiera quedado, esto
    // respondería `repetido` y la cuenta no se crearia nunca.
    const buena = await entregarEvento(
      TIPO_CONTRATO_FORMALIZADO,
      { id_contrato: idContrato, id_inmueble: idInmueble, canon: 900, fecha_inicio_corte: '2026-01-01' },
      { ...mala.sobre, payload: { ...mala.sobre.payload, canon: 900 } },
    );

    expect(buena.respuesta.statusCode).toBe(200);
    expect(buena.respuesta.body.repetido).toBe(false);
    expect(await cuentasDe(idContrato)).toHaveLength(1);
  });
});

describe('Y desde el paso 7 el consumidor también PRODUCE', () => {
  /**
   * ── TRES ESCRITURAS EN UNA TRANSACCION ────────────────────────────────────
   *
   * Este servicio es el primero del sistema que consume y produce, y las dos mitades
   * caben en la misma transaccion: la marca del `id_evento` que pone `crearConsumidor`,
   * el INSERT de la cuenta de cobro y el registro de `CuentaCobroGenerada` en la tabla
   * de salida. Mismo esquema, misma base.
   *
   * La consecuencia es la que interesa: no puede haber una cuenta sin su aviso, ni un
   * aviso sin su cuenta, ni ninguna de las dos si el evento resulta ser repetido.
   */

  test('crear la primera cuenta anuncia CuentaCobroGenerada', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();

    const { respuesta } = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 2000,
      fecha_inicio_corte: '2026-04-10',
      id_inquilino: inquilino.sub,
    });
    expect(respuesta.statusCode).toBe(200);

    const cuentas = await cuentasDe(idContrato);
    expect(cuentas).toHaveLength(1);

    const eventos = await eventosDeSalida('CuentaCobroGenerada');
    const suyo = eventos.find(
      (e) => e.payload['id_cuenta_cobro'] === cuentas[0]!.id_cuenta_cobro,
    );

    expect(suyo).toBeDefined();
    expect(suyo!.payload['id_inquilino']).toBe(inquilino.sub);
    expect(suyo!.payload['id_contrato']).toBe(idContrato);
    expect(Number(suyo!.payload['valor'])).toBe(2000);
    expect(suyo!.estado).toBe('pendiente');
  });

  test('una reentrega tampoco anuncia dos veces', async () => {
    // La idempotencia cubre las DOS escrituras, no sólo la cuenta de cobro. Si la marca
    // del evento protegiera una y no la otra, el inquilino recibiría dos correos por la
    // misma factura — y un correo no se puede recoger.
    const { idContrato, idInmueble, inquilino } = escenario();

    const primera = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 3000,
      fecha_inicio_corte: '2026-05-10',
      id_inquilino: inquilino.sub,
    });

    const avisosDelContrato = async () =>
      (await eventosDeSalida('CuentaCobroGenerada')).filter(
        (e) => e.payload['id_contrato'] === idContrato,
      );

    expect(await avisosDelContrato()).toHaveLength(1);

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, primera.sobre.payload, primera.sobre);
    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, primera.sobre.payload, primera.sobre);

    expect(await cuentasDe(idContrato)).toHaveLength(1);
    expect(await avisosDelContrato()).toHaveLength(1);
  });

  test('un sobre VERSION 1, sin id_inquilino, factura igual y no avisa', async () => {
    // ── EL CASO DEL DESPLIEGUE, Y LA RAZON DE QUE EL CAMPO SEA OPCIONAL ────
    //
    // `id_inquilino` llegó con la versión 2 del evento. En el despliegue del paso 7
    // puede haber sobres versión 1 esperando en `contratos.eventos_salida`, y lanzar ahí
    // sería apartar el evento tras diez intentos y dejar un contrato SIN FACTURAR por no
    // poder mandar un correo.
    //
    // Así que la cuenta se crea y el aviso se omite. Facturar sin avisar es una
    // degradación aceptable; no facturar, no.
    const { idContrato, idInmueble } = escenario();

    const { respuesta } = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 4000,
      fecha_inicio_corte: '2026-06-10',
    } as never);

    // Ni 400 ni 500: el evento se procesa.
    expect(respuesta.statusCode).toBe(200);

    // La cuenta está.
    expect(await cuentasDe(idContrato)).toHaveLength(1);

    // El aviso no.
    const avisos = (await eventosDeSalida('CuentaCobroGenerada')).filter(
      (e) => e.payload['id_contrato'] === idContrato,
    );
    expect(avisos).toHaveLength(0);
  });

  test('si el manejador falla, no queda ni cuenta ni aviso', async () => {
    // La atomicidad por el lado del fallo. Un canon inválido hace fallar la validación
    // de la carga, y entonces no puede quedar media cosa: ni la cuenta, ni el aviso, ni
    // la marca del evento — porque si quedara la marca, el reintento del productor se
    // descartaría como repetido y el contrato no se facturaría nunca.
    const { idContrato, idInmueble, inquilino } = escenario();

    const avisosAntes = (await eventosDeSalida('CuentaCobroGenerada')).length;

    const { respuesta } = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 0,
      fecha_inicio_corte: '2026-07-10',
      id_inquilino: inquilino.sub,
    });

    expect(respuesta.statusCode).toBe(500);
    expect(await cuentasDe(idContrato)).toHaveLength(0);
    expect((await eventosDeSalida('CuentaCobroGenerada')).length).toBe(avisosAntes);
  });
});
