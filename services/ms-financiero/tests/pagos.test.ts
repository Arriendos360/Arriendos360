/**
 * Cuentas de cobro y transacciones, de punta a punta por la API.
 *
 * Es la suite que hereda `apps/gateway/tests/pagos.test.js` y
 * `apps/gateway/tests/abonos.test.js`, que se fueron con el servicio. Las
 * afirmaciones son las mismas —el saldo derivado, el sobrepago, la anulacion, la
 * foto del comprobante— porque el paso 6e NO cambia el comportamiento: cambia
 * donde corre.
 *
 * Lo que si cambia es como se monta el escenario. El contrato ya no se crea por
 * la API del gateway: vive en ms-contratos, y aqui lo pone su doble. Es
 * exactamente lo que ocurre en produccion desde el punto de vista de este
 * servicio.
 *
 * ── LO QUE ESTA SUITE DEFIENDE ─────────────────────────────────────────────
 *
 *   1. El saldo derivado da los MISMOS numeros que daba la columna
 *      `saldo_pendiente` que el paso 6c borro.
 *   2. Anular devuelve el saldo Y el estado a lo que eran antes de registrar la
 *      transaccion, sin que nadie los haya guardado en ninguna parte.
 *   3. `saldo_restante_momento` no se deriva y no se toca: es la foto de un
 *      comprobante ya emitido.
 *   4. El ABAC de la Capa 3, que es lo que el gateway no puede hacer por este
 *      servicio (regla dura 8).
 */

import request from 'supertest';

import { Transaccion } from '../src/models/Transaccion';
import {
  ESTADO_CUENTA_PAGADA,
  ESTADO_CUENTA_PARCIAL,
  ESTADO_CUENTA_PENDIENTE,
  ESTADO_TRANSACCION_ANULADA,
} from '../src/models/constantes';
import {
  app,
  cerrarEntorno,
  conToken,
  contratosFalso,
  crearCuenta,
  escenario,
  prepararEntorno,
  propietario,
} from './utiles/entorno';

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('Emision de una cuenta de cobro', () => {
  test('nace con periodo explicito y saldo igual a su importe', async () => {
    const { propietario: duenio, idContrato } = escenario();

    const { respuesta } = await crearCuenta(duenio.token, idContrato, {
      valor: 1200,
      inicio: '2026-01-01',
    });

    expect(respuesta.statusCode).toBe(201);

    const cuenta = respuesta.body.cuenta_cobro;

    // El saldo YA NO ES UNA COLUMNA. Viene igual, con el mismo nombre y el
    // mismo valor, pero derivado: sin transacciones todavia, es el importe
    // entero.
    expect(cuenta.saldo_pendiente).toBe(1200);
    expect(cuenta.estado).toBe(ESTADO_CUENTA_PENDIENTE);

    // El periodo sustituye a `mes_correspondiente`: dos fechas, no un instante.
    // El fin es la vispera del siguiente corte.
    expect(cuenta.inicio).toBe('2026-01-01');
    expect(cuenta.fin).toBe('2026-01-31');
  });

  test('un inquilino no puede emitir un cobro, aunque sea parte del contrato', async () => {
    // Capa 3. El gateway ya lo deniega por rol en su matriz, pero este servicio
    // no se fia de que lo haya hecho (regla dura 7).
    const { inquilino: arrendatario, idContrato } = escenario();

    const { respuesta } = await crearCuenta(arrendatario.token, idContrato);

    expect(respuesta.statusCode).toBe(403);
  });

  test('un propietario ajeno tampoco: el ABAC comprueba de quien es', async () => {
    // Y esto SI es lo que solo puede hacer este servicio: el rol es correcto,
    // lo que falla es que el contrato no es suyo.
    const { idContrato } = escenario();
    const intruso = propietario();

    const { respuesta } = await crearCuenta(intruso.token, idContrato);

    expect(respuesta.statusCode).toBe(403);
  });

  test('si ms-contratos no responde, es 502 y no 403', async () => {
    // La politica de fallo que separa un error honesto de una mentira. Decirle
    // «no tienes permisos» a alguien cuando en realidad no se ha podido
    // comprobar es la peor de las respuestas posibles.
    const { propietario: duenio, idContrato } = escenario();

    contratosFalso().caer(503);
    const { respuesta } = await crearCuenta(duenio.token, idContrato);
    contratosFalso().levantar();

    expect(respuesta.statusCode).toBe(502);
  });
});

describe('RF-17: registro de transacciones', () => {
  let token: string;
  let idCuenta: string;

  /** Lo que la API dice hoy que se debe de esta cuenta. */
  const saldoDeLaCuenta = async () => {
    const respuesta = await request(app)
      .get('/api/pagos')
      .set(...conToken(token));

    return respuesta.body.find(
      (c: { id_cuenta_cobro: string }) => c.id_cuenta_cobro === idCuenta,
    );
  };

  /** Registra una transaccion contra la cuenta de este bloque. */
  const registrar = (cuerpo: Record<string, unknown>) =>
    request(app)
      .post('/api/pagos')
      .set(...conToken(token))
      .send({ id_cuenta_cobro: idCuenta, tipo: 'INGRESO', ...cuerpo });

  beforeAll(async () => {
    const { propietario: duenio, idContrato } = escenario();
    token = duenio.token;

    const { id } = await crearCuenta(duenio.token, idContrato, {
      valor: 1000,
      inicio: '2026-01-01',
    });
    idCuenta = id;
  });

  test('un pago parcial deja la cuenta en PARCIAL', async () => {
    const respuesta = await registrar({
      monto: 400,
      medio_pago: 'Transferencia',
      observaciones: 'Primer abono',
    });

    expect(respuesta.statusCode).toBe(201);
    expect(parseFloat(respuesta.body.cuenta_cobro.saldo_pendiente)).toBe(600);
    expect(respuesta.body.cuenta_cobro.estado).toBe(ESTADO_CUENTA_PARCIAL);
    expect(parseFloat(respuesta.body.transaccion.monto)).toBe(400);
  });

  test('el saldo derivado coincide con el que daba la columna: 1000 - 400 = 600', async () => {
    // Es el mismo numero que devolvia `saldo_pendiente` cuando era columna. La
    // diferencia es que ahora sale de sumar las transacciones, asi que esta
    // asercion es la que garantiza que quitarla no movio nada.
    const cuenta = await saldoDeLaCuenta();
    expect(cuenta.saldo_pendiente).toBe(600);
    expect(cuenta.estado).toBe(ESTADO_CUENTA_PARCIAL);
  });

  test('`tipo` y `medio_pago` son campos distintos y no se confunden', async () => {
    // La trampa del paso 6c: `tipo_transaccion` guardaba MEDIOS de pago, y
    // mapearlo por el parecido del nombre habria puesto "Efectivo" en `tipo`.
    const transacciones = await request(app)
      .get(`/api/pagos/${idCuenta}/transacciones`)
      .set(...conToken(token));

    expect(transacciones.body[0].tipo).toBe('INGRESO');
    expect(transacciones.body[0].medio_pago).toBe('Transferencia');
  });

  test('bloquea un sobrepago (monto > saldo pendiente)', async () => {
    const respuesta = await registrar({ monto: 700 }); // el saldo es 600

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body.mensaje).toContain('Monto inválido o superior al saldo');
  });

  test('un tipo de transaccion que no existe se rechaza', async () => {
    const respuesta = await registrar({ monto: 1, tipo: 'REGALO', medio_pago: 'Efectivo' });

    expect(respuesta.statusCode).toBe(400);
  });

  test('completa el pago al llegar a saldo cero', async () => {
    const respuesta = await registrar({ monto: 600, medio_pago: 'Efectivo' });

    expect(respuesta.statusCode).toBe(201);
    expect(parseFloat(respuesta.body.cuenta_cobro.saldo_pendiente)).toBe(0);
    expect(respuesta.body.cuenta_cobro.estado).toBe(ESTADO_CUENTA_PAGADA);
  });

  test('el historial de la cuenta tiene las dos transacciones', async () => {
    const respuesta = await request(app)
      .get(`/api/pagos/${idCuenta}/transacciones`)
      .set(...conToken(token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).toHaveLength(2);
  });

  test('el saldo derivado sobrevive a una relectura', async () => {
    const cuenta = await saldoDeLaCuenta();
    expect(cuenta.saldo_pendiente).toBe(0);
    expect(cuenta.estado).toBe(ESTADO_CUENTA_PAGADA);
  });
});

describe('Anulacion de transacciones', () => {
  let token: string;
  let idCuenta: string;

  const saldoDeLaCuenta = async () => {
    const respuesta = await request(app)
      .get('/api/pagos')
      .set(...conToken(token));

    return respuesta.body.find(
      (c: { id_cuenta_cobro: string }) => c.id_cuenta_cobro === idCuenta,
    );
  };

  const transaccionesDe = async () => {
    const respuesta = await request(app)
      .get(`/api/pagos/${idCuenta}/transacciones`)
      .set(...conToken(token));
    return respuesta.body as Array<Record<string, string>>;
  };

  beforeAll(async () => {
    const { propietario: duenio, idContrato } = escenario();
    token = duenio.token;

    const { id } = await crearCuenta(duenio.token, idContrato, {
      valor: 1000,
      inicio: '2026-02-01',
    });
    idCuenta = id;

    for (const monto of [400, 600]) {
      await request(app)
        .post('/api/pagos')
        .set(...conToken(token))
        .send({ id_cuenta_cobro: idCuenta, monto, tipo: 'INGRESO', medio_pago: 'Efectivo' });
    }
  });

  test('devuelve el saldo y el estado a lo que eran antes de registrarla', async () => {
    // Anular es la unica operacion que deshace un movimiento contable, y lo
    // deshace SIN guardar nada: el saldo y el estado salen otra vez de la misma
    // suma de siempre, que ahora ignora la fila anulada.
    const antes = await saldoDeLaCuenta();
    expect(antes.saldo_pendiente).toBe(0);
    expect(antes.estado).toBe(ESTADO_CUENTA_PAGADA);

    const deSeiscientos = (await transaccionesDe()).find((t) => parseFloat(t['monto']!) === 600)!;

    const anulacion = await request(app)
      .post(`/api/pagos/transacciones/${deSeiscientos['id_transaccion']}/anular`)
      .set(...conToken(token));

    expect(anulacion.statusCode).toBe(200);

    // Exactamente el estado y el saldo que habia justo antes de los 600.
    const despues = await saldoDeLaCuenta();
    expect(despues.saldo_pendiente).toBe(600);
    expect(despues.estado).toBe(ESTADO_CUENTA_PARCIAL);
  });

  test('la transaccion anulada no se borra: sigue en el historial, marcada', async () => {
    // Esconderla seria esconder que el movimiento se registro y se corrigio, que
    // es justo lo que el estado existe para hacer visible.
    const transacciones = await transaccionesDe();

    expect(transacciones).toHaveLength(2);
    const anulada = transacciones.find((t) => parseFloat(t['monto']!) === 600)!;
    expect(anulada['estado']).toBe(ESTADO_TRANSACCION_ANULADA);
  });

  test('la foto `saldo_restante_momento` no se mueve', async () => {
    // La transaccion de 400 se registro cuando quedaban 600 por pagar, y su
    // comprobante lo dice. Despues llegaron 600 y se anularon: el saldo vigente
    // ha ido de 600 a 0 y otra vez a 600, pero la FOTO no se ha movido.
    const transacciones = await transaccionesDe();

    const deCuatrocientos = transacciones.find((t) => parseFloat(t['monto']!) === 400)!;
    expect(parseFloat(deCuatrocientos['saldo_restante_momento']!)).toBe(600);

    // Y el de la anulada conserva el suyo, que era 0: el documento que alguien
    // recibio decia «saldado» y sigue diciendolo.
    const anulada = transacciones.find((t) => parseFloat(t['monto']!) === 600)!;
    expect(parseFloat(anulada['saldo_restante_momento']!)).toBe(0);
  });

  test('anular dos veces la misma transaccion responde 409, no 403', async () => {
    // El recurso es suyo y su rol es el correcto: las dos capas de autorizacion
    // ya dijeron que si. Lo que falla es el estado del recurso.
    const anulada = (await transaccionesDe()).find(
      (t) => t['estado'] === ESTADO_TRANSACCION_ANULADA,
    )!;

    const respuesta = await request(app)
      .post(`/api/pagos/transacciones/${anulada['id_transaccion']}/anular`)
      .set(...conToken(token));

    expect(respuesta.statusCode).toBe(409);
  });

  test('anular la ultima devuelve la cuenta a PENDIENTE y sin fecha de pago', async () => {
    // El estado se recalcula a partir del saldo, no se recuerda: con todo
    // anulado, la cuenta vuelve a estar como recien emitida.
    const deCuatrocientos = (await transaccionesDe()).find(
      (t) => parseFloat(t['monto']!) === 400,
    )!;

    await request(app)
      .post(`/api/pagos/transacciones/${deCuatrocientos['id_transaccion']}/anular`)
      .set(...conToken(token));

    const cuenta = await saldoDeLaCuenta();
    expect(cuenta.saldo_pendiente).toBe(1000);
    expect(cuenta.estado).toBe(ESTADO_CUENTA_PENDIENTE);
    expect(cuenta.fecha_pago).toBeNull();
  });

  test('un propietario ajeno no puede anular', async () => {
    const intruso = propietario();
    const alguna = (await transaccionesDe())[0]!;

    const respuesta = await request(app)
      .post(`/api/pagos/transacciones/${alguna['id_transaccion']}/anular`)
      .set(...conToken(intruso.token));

    expect(respuesta.statusCode).toBe(403);
  });
});

describe('Visibilidad: la disyuncion de pertenencia', () => {
  test('el INQUILINO ve las cuentas de su contrato', async () => {
    // La mitad de la disyuncion que no es la de propietario. La resuelve
    // ms-contratos entera y aqui llega como una lista de identificadores.
    const { propietario: duenio, inquilino: arrendatario, idContrato } = escenario();
    const { id } = await crearCuenta(duenio.token, idContrato, { inicio: '2026-03-01' });

    const respuesta = await request(app)
      .get('/api/pagos')
      .set(...conToken(arrendatario.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.map((c: { id_cuenta_cobro: string }) => c.id_cuenta_cobro)).toContain(id);
  });

  test('un tercero no ve nada', async () => {
    const { propietario: duenio, idContrato } = escenario();
    await crearCuenta(duenio.token, idContrato, { inicio: '2026-04-01' });

    const ajeno = propietario();
    const respuesta = await request(app)
      .get('/api/pagos')
      .set(...conToken(ajeno.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).toHaveLength(0);
  });

  test('la lista trae el contrato y su inmueble compuestos', async () => {
    // La ruta que la SPA lee: `cuenta.Contrato.Inmueble.direccion`. Ha
    // sobrevivido a tres extracciones sin cambiar.
    const { propietario: duenio, idContrato } = escenario();
    const { id } = await crearCuenta(duenio.token, idContrato, { inicio: '2026-05-01' });

    const respuesta = await request(app)
      .get('/api/pagos')
      .set(...conToken(duenio.token));

    const cuenta = respuesta.body.find(
      (c: { id_cuenta_cobro: string }) => c.id_cuenta_cobro === id,
    );

    expect(cuenta.Contrato.id_contrato).toBe(idContrato);
    expect(cuenta.Contrato.Inmueble.direccion).toBe('Calle 123 #45-67');
  });

  test('si ms-contratos no responde al listar, es 502', async () => {
    const { propietario: duenio } = escenario();

    contratosFalso().caer(503);
    const respuesta = await request(app)
      .get('/api/pagos')
      .set(...conToken(duenio.token));
    contratosFalso().levantar();

    expect(respuesta.statusCode).toBe(502);
  });

  test('sin token no se entra', async () => {
    // Confianza cero: este servicio verifica el token por su cuenta aunque la
    // peticion venga del gateway.
    const respuesta = await request(app).get('/api/pagos');
    expect(respuesta.statusCode).toBe(401);
  });
});

describe('verificar-mora aplica la MISMA regla que el motor', () => {
  test('no marca una cuenta cuyo corte paso hace menos de 6 dias', async () => {
    // ── LA TRAMPA QUE ESTE PASO CIERRA ────────────────────────────────────
    //
    // CLAUDE.md la tenia anotada: «un contrato de 16 lineas de mora no existe:
    // `verificar-mora` y el motor no aplican la misma regla». Este endpoint
    // marcaba EN_MORA con que el corte hubiera pasado UN dia, mientras que
    // `procesarPagos()` espera al sexto. Quien lo disparara desde Postman
    // dejaba cuentas en mora que el motor no habria marcado.
    //
    // Ahora los dos usan `DIAS_PARA_MORA`.
    const hoy = new Date();
    const haceTresDias = new Date(hoy.getTime() - 3 * 86400000).toISOString().slice(0, 10);

    const { propietario: duenio, idContrato } = escenario();
    const { id } = await crearCuenta(duenio.token, idContrato, { inicio: haceTresDias });

    const respuesta = await request(app)
      .post('/api/pagos/verificar-mora')
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);

    const cuentas = await request(app)
      .get('/api/pagos')
      .set(...conToken(duenio.token));

    const cuenta = cuentas.body.find(
      (c: { id_cuenta_cobro: string }) => c.id_cuenta_cobro === id,
    );
    expect(cuenta.estado).toBe(ESTADO_CUENTA_PENDIENTE);
  });

  test('marca una cuya corte paso hace mas de 6', async () => {
    const hoy = new Date();
    const haceOchoDias = new Date(hoy.getTime() - 8 * 86400000).toISOString().slice(0, 10);

    const { propietario: duenio, idContrato } = escenario();
    const { id } = await crearCuenta(duenio.token, idContrato, { inicio: haceOchoDias });

    const respuesta = await request(app)
      .post('/api/pagos/verificar-mora')
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.pagos_actualizados).toBeGreaterThan(0);

    const cuentas = await request(app)
      .get('/api/pagos')
      .set(...conToken(duenio.token));

    const cuenta = cuentas.body.find(
      (c: { id_cuenta_cobro: string }) => c.id_cuenta_cobro === id,
    );
    expect(cuenta.estado).toBe('EN_MORA');
  });

  test('un inquilino no puede marcarse a si mismo', async () => {
    // Verificar la mora ESCRIBE, asi que aqui no basta con ser parte: hay que
    // ser el dueño del inmueble.
    const { inquilino: arrendatario } = escenario();

    const respuesta = await request(app)
      .post('/api/pagos/verificar-mora')
      .set(...conToken(arrendatario.token));

    expect(respuesta.statusCode).toBe(403);
  });
});

describe('El historial global', () => {
  test('trae las transacciones del usuario con su cuenta y su contrato', async () => {
    const { propietario: duenio, idContrato } = escenario();
    const { id } = await crearCuenta(duenio.token, idContrato, { inicio: '2026-06-01' });

    await request(app)
      .post('/api/pagos')
      .set(...conToken(duenio.token))
      .send({ id_cuenta_cobro: id, monto: 300, tipo: 'INGRESO', medio_pago: 'Efectivo' });

    const respuesta = await request(app)
      .get('/api/pagos/historial-transacciones')
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);

    const suya = respuesta.body.find(
      (t: { CuentaCobro: { id_cuenta_cobro: string } }) =>
        t.CuentaCobro.id_cuenta_cobro === id,
    );

    expect(suya).toBeDefined();
    // El saldo anidado: la transaccion no lo tiene, cuelga de la cuenta.
    expect(suya.CuentaCobro.saldo_pendiente).toBe(700);
    expect(suya.CuentaCobro.Contrato.id_contrato).toBe(idContrato);
  });
});

describe('La transaccion se escribe con la fila bloqueada', () => {
  test('dos registros simultaneos no cobran de mas', async () => {
    // El `FOR UPDATE` sobre la cuenta. Sin el, los dos leerian el saldo entero
    // y los dos lo aceptarian: la cuenta acabaria con 1200 cobrados sobre 1000.
    const { propietario: duenio, idContrato } = escenario();
    const { id } = await crearCuenta(duenio.token, idContrato, {
      valor: 1000,
      inicio: '2026-07-01',
    });

    const pagar = (monto: number) =>
      request(app)
        .post('/api/pagos')
        .set(...conToken(duenio.token))
        .send({ id_cuenta_cobro: id, monto, tipo: 'INGRESO', medio_pago: 'Efectivo' });

    const [uno, dos] = await Promise.all([pagar(600), pagar(600)]);

    // Uno entra y el otro se rechaza por sobrepago. Cual de los dos es una
    // carrera legitima; que entren los dos, no.
    const codigos = [uno.statusCode, dos.statusCode].sort();
    expect(codigos).toEqual([201, 400]);

    const confirmadas = await Transaccion.findAll({
      where: { id_cuenta_cobro: id, estado: 'CONFIRMADA' },
    });
    expect(confirmadas).toHaveLength(1);
  });
});
