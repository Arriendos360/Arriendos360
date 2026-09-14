/**
 * Motor financiero.
 *
 * Construye los datos con los modelos y con el doble de ms-contratos, porque el
 * motor no tiene endpoint propio desde que se elimino `/api/admin`. Ni los
 * contratos ni los inmuebles ni los usuarios se crean aqui: viven en otros
 * servicios y para estas pruebas los ponen sus dobles. A ms-financiero le llega
 * el `id_contrato`, que es todo lo que guarda de ellos.
 *
 * ── LO QUE CAMBIA EN EL PASO 6e, Y ES EL GRUESO DE ESTA SUITE ──────────────
 *
 * `procesarContratos` YA NO GENERA LA PRIMERA CUENTA DE COBRO: la crea el
 * consumidor de `ContratoFormalizado`. Este barrido se queda con los meses
 * siguientes.
 *
 * Eso hace que la prueba de «no duplica» sea distinta de la que habia. Antes
 * comprobaba que un segundo barrido no repite lo que el primero genero —una
 * prueba sobre el propio barrido—; ahora hay que comprobar ademas que no pisa lo
 * que hizo OTRO camino, que es donde estaba el riesgo real de la extraccion.
 *
 * ── LAS TRES AFIRMACIONES DE SIEMPRE SIGUEN AQUI ───────────────────────────
 *
 *   - el recibo se genera dos dias antes del aniversario,
 *   - la mora entra al sexto dia del corte,
 *   - el barrido compone las partes en un numero fijo de viajes.
 *
 * La tercera cambia de numero por tercera vez: eran TRES peticiones cuando esto
 * vivia en el gateway (contratos, inmuebles, identidad), pasaron a DOS en el 6e
 * porque el inmueble viaja dentro del contrato, y desde el paso 7 es UNA. La que
 * sobraba era la de ms-identidad, a por las direcciones de correo: el motor ya no
 * manda correos, anota eventos que llevan el `id_usuario`, y quien resuelve el
 * destinatario es ms-notificaciones.
 *
 * Lo que no cambia en ninguna de las tres versiones es lo que la prueba defiende:
 * que el numero NO crece con el numero de contratos.
 *
 * ── LO QUE CAMBIA EN EL PASO 7 ─────────────────────────────────────────────
 *
 * El motor no manda correos: emite `CuentaCobroGenerada`, `CuentaCobroPorVencer` y
 * `CuentaCobroEnMora` en su tabla de salida. Asi que donde antes no habia nada que
 * comprobar —los correos se perdian en un mailer que se tragaba los fallos— ahora
 * hay filas que mirar, y esta suite las mira.
 *
 * ── Y LAS FECHAS SON DETERMINISTAS ─────────────────────────────────────────
 *
 * El motor pregunta que dia es en `America/Bogota`, que es la zona del negocio,
 * y esta suite parte de ESE MISMO dia. La consecuencia es que dice lo mismo a
 * las 02:00 que a las 23:00, y en un contenedor en UTC que en un portatil en
 * Bogota.
 */

import request from 'supertest';
import { TIPO_CONTRATO_FORMALIZADO } from 'arriendos360-shared';
import { hoyEnZonaNegocio } from 'arriendos360-shared';

import { CuentaCobro } from '../src/models/CuentaCobro';
import {
  ESTADO_CUENTA_EN_MORA,
  ESTADO_CUENTA_PAGADA,
  ESTADO_CUENTA_PARCIAL,
  ESTADO_CUENTA_PENDIENTE,
  USUARIO_SISTEMA,
} from '../src/models/constantes';
import {
  DIAS_AVISO_PREVIO,
  DIAS_PARA_MORA,
  procesarContratos,
  procesarPagos,
} from '../src/services/motor';
import {
  app,
  cerrarEntorno,
  conToken,
  contratoEnElDoble,
  contratosFalso,
  entregarEvento,
  escenario,
  eventosDeSalida,
  identidadFalsa,
  inmuebleDe,
  prepararEntorno,
  propietario,
  usuarioDe,
} from './utiles/entorno';

/** Suma dias a un `YYYY-MM-DD` sin salir del calendario. */
const sumarDias = (fechaISO: string, dias: number): string =>
  new Date(Date.parse(`${fechaISO}T00:00:00Z`) + dias * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

const cuentasDe = (idContrato: string) =>
  CuentaCobro.findAll({ where: { id_contrato: idContrato }, order: [['inicio', 'ASC']] });

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('RF-11: generacion de las cuentas de los meses SIGUIENTES', () => {
  jest.setTimeout(20000);

  test('genera la cuenta si faltan 2 dias para el aniversario', async () => {
    const hoy = hoyEnZonaNegocio();
    const pasadoManana = sumarDias(hoy, 2);

    // La fecha de corte del contrato se pone en un mes ANTERIOR con el mismo
    // dia, para que el periodo que toca facturar no sea el primero: el primero
    // es del consumidor del evento y este barrido lo salta siempre.
    const corteOriginal = sumarDias(pasadoManana, -365);

    const { idContrato } = escenario({ fecha_inicio_corte: corteOriginal, canon: 1000 });

    await procesarContratos();

    const cuentas = await cuentasDe(idContrato);
    expect(cuentas).toHaveLength(1);

    const cuenta = cuentas[0]!;
    expect(cuenta.estado).toBe(ESTADO_CUENTA_PENDIENTE);
    expect(parseFloat(String(cuenta.valor))).toBe(1000);

    // El periodo es EXPLICITO: la cuenta empieza en el corte y termina la
    // vispera del siguiente, no en un mes suelto.
    expect(cuenta.inicio).toBe(pasadoManana);
    expect(cuenta.fin > cuenta.inicio).toBe(true);

    // El motor corre sin usuario autenticado: la auditoria queda a nombre del
    // usuario de sistema.
    expect(cuenta.creado_por).toBe(USUARIO_SISTEMA);
  });

  test('no genera nada si al corte le faltan mas de 2 dias', async () => {
    // La frontera por el otro lado. Sin esto, adelantar la ventana pasaria en
    // verde.
    const dentroDeDiez = sumarDias(hoyEnZonaNegocio(), 10);
    const corteOriginal = sumarDias(dentroDeDiez, -365);

    const { idContrato } = escenario({ fecha_inicio_corte: corteOriginal });

    await procesarContratos();

    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('un contrato no activo se ignora', async () => {
    const corteOriginal = sumarDias(sumarDias(hoyEnZonaNegocio(), 2), -365);
    const { idContrato } = escenario({
      fecha_inicio_corte: corteOriginal,
      estado: 'finalizado',
    });

    await procesarContratos();

    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });
});

describe('El primer periodo es del evento, no del barrido', () => {
  jest.setTimeout(20000);

  test('procesarContratos NO genera la cuenta del primer periodo', async () => {
    // La frontera del paso 6e. El contrato tiene su corte HOY+2, asi que cae
    // dentro de la ventana de dos dias; si el barrido no supiera que ese es el
    // primer periodo, lo facturaria.
    //
    // Y se salta SIEMPRE, exista ya la cuenta o no: saltarlo solo cuando ya
    // existe dejaria que el motor generase la primera cuenta de un contrato cuyo
    // evento todavia no ha llegado, y entonces habria dos caminos escribiendo la
    // misma fila.
    const pasadoManana = sumarDias(hoyEnZonaNegocio(), 2);
    const { idContrato } = escenario({ fecha_inicio_corte: pasadoManana });

    await procesarContratos();

    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('el evento la crea, y un barrido posterior NO la duplica', async () => {
    // El caso completo, y el que el requisito pide comprobar: primero llega el
    // evento, despues corre el motor, y en el primer periodo tiene que haber
    // UNA cuenta.
    const pasadoManana = sumarDias(hoyEnZonaNegocio(), 2);
    const { idContrato, idInmueble, inquilino } = escenario({
      fecha_inicio_corte: pasadoManana,
    });

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: pasadoManana,
      // Version 2: el sobre trae el inquilino, para que la cuenta que nace del evento
      // pueda anunciarse. Ver la cabecera del tipo en packages/shared.
      id_inquilino: inquilino.sub,
    });

    expect(await cuentasDe(idContrato)).toHaveLength(1);

    await procesarContratos();
    await procesarContratos();

    const cuentas = await cuentasDe(idContrato);
    expect(cuentas).toHaveLength(1);
    expect(cuentas[0]!.inicio).toBe(pasadoManana);
  });

  test('y el orden inverso da el mismo resultado: barrido y despues evento', async () => {
    // El bus es asincrono, asi que el barrido de medianoche puede caer entre la
    // firma del contrato y la entrega de su evento. Que el barrido se salte el
    // primer periodo SIEMPRE es lo que hace que ese orden no importe.
    const pasadoManana = sumarDias(hoyEnZonaNegocio(), 2);
    const { idContrato, idInmueble } = escenario({ fecha_inicio_corte: pasadoManana });

    await procesarContratos();
    expect(await cuentasDe(idContrato)).toHaveLength(0);

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: pasadoManana,
    });

    expect(await cuentasDe(idContrato)).toHaveLength(1);
  });

  test('no duplica una cuenta de un periodo posterior ya generado', async () => {
    // La comprobacion de siempre, que sigue haciendo falta: dos barridos el
    // mismo dia no generan dos cuentas. Ahora es una igualdad sobre `inicio`,
    // respaldada ademas por un indice unico.
    const corteOriginal = sumarDias(sumarDias(hoyEnZonaNegocio(), 2), -365);
    const { idContrato } = escenario({ fecha_inicio_corte: corteOriginal });

    await procesarContratos();
    const despuesDelPrimero = (await cuentasDe(idContrato)).length;
    expect(despuesDelPrimero).toBe(1);

    await procesarContratos();

    expect(await cuentasDe(idContrato)).toHaveLength(despuesDelPrimero);
  });
});

describe('RF-12: mora', () => {
  jest.setTimeout(20000);

  test('cambia a MORA despues de 6 dias del corte', async () => {
    const { idContrato } = escenario();
    const haceSieteDias = sumarDias(hoyEnZonaNegocio(), -7);

    const cuenta = await CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'Canon vencido',
      valor: 1000,
      inicio: haceSieteDias,
      fin: sumarDias(haceSieteDias, 29),
      estado: ESTADO_CUENTA_PENDIENTE,
    });

    await procesarPagos();

    const actualizada = await CuentaCobro.findByPk(cuenta.id_cuenta_cobro);
    expect(actualizada!.estado).toBe(ESTADO_CUENTA_EN_MORA);
  });

  test('al quinto dia todavia no hay mora: entra al sexto', async () => {
    // La frontera. Sin esto, adelantar la mora un dia pasaria en verde.
    const { idContrato } = escenario();
    const haceCincoDias = sumarDias(hoyEnZonaNegocio(), -5);

    const cuenta = await CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'Canon reciente',
      valor: 1000,
      inicio: haceCincoDias,
      fin: sumarDias(haceCincoDias, 29),
      estado: ESTADO_CUENTA_PENDIENTE,
    });

    await procesarPagos();

    const actualizada = await CuentaCobro.findByPk(cuenta.id_cuenta_cobro);
    expect(actualizada!.estado).toBe(ESTADO_CUENTA_PENDIENTE);
  });

});

describe('RF-12: un abono parcial no evita la mora', () => {
  jest.setTimeout(20000);

  // ── EL AGUJERO QUE CIERRAN ESTAS PRUEBAS ───────────────────────────────────
  //
  // Aqui habia una prueba que afirmaba lo contrario: «una cuenta PARCIAL no entra en
  // mora por este camino». Documentaba el filtro `estado IN (1, 3)` del barrido
  // original, que sobrevivio a siete tramos: una cuenta que recibia un abono antes
  // del sexto dia pasaba a PARCIAL y salia del motor para siempre. La regla es la del
  // saldo: con saldo y el corte vencido, mora, haya abonos o no.
  //
  // Los abonos se registran por la API y no con `CuentaCobro.update`, porque el
  // estado que deja un abono lo decide `estadoSegunSaldo`, y eso es parte de lo que
  // se comprueba. El paso del tiempo se simula corriendo el corte hacia atras.

  /** Registra un abono por la API. */
  const abonar = (token: string, idCuenta: string, monto: number) =>
    request(app)
      .post('/api/pagos')
      .set(...conToken(token))
      .send({ id_cuenta_cobro: idCuenta, monto, tipo: 'INGRESO', medio_pago: 'Transferencia' });

  /** Los avisos de mora anotados para UNA cuenta. */
  const morasDe = async (idCuenta: string) =>
    (await eventosDeSalida('CuentaCobroEnMora')).filter(
      (evento) => evento.payload['id_cuenta_cobro'] === idCuenta,
    );

  /** Una cuenta de 1000 cuyo corte fue hace `dias` dias. */
  const cuentaConCorteHace = (idContrato: string, dias: number) => {
    const corte = sumarDias(hoyEnZonaNegocio(), -dias);
    return CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'Canon',
      valor: 1000,
      inicio: corte,
      fin: sumarDias(corte, 29),
      estado: ESTADO_CUENTA_PENDIENTE,
    });
  };

  test('abono parcial ANTES del sexto dia: la cuenta entra en mora igual', async () => {
    const { propietario: duenio, idContrato } = escenario();
    const cuenta = await cuentaConCorteHace(idContrato, 3);

    const abono = await abonar(duenio.token, cuenta.id_cuenta_cobro, 400);
    expect(abono.statusCode).toBe(201);
    expect(abono.body.cuenta_cobro.estado).toBe(ESTADO_CUENTA_PARCIAL);

    // Al tercer dia todavia no hay mora, abonada o no.
    await procesarPagos();
    expect((await CuentaCobro.findByPk(cuenta.id_cuenta_cobro))!.estado).toBe(
      ESTADO_CUENTA_PARCIAL,
    );

    // Pasan cuatro dias: el corte queda a siete.
    await cuenta.update({ inicio: sumarDias(hoyEnZonaNegocio(), -7) });
    await procesarPagos();

    expect((await CuentaCobro.findByPk(cuenta.id_cuenta_cobro))!.estado).toBe(
      ESTADO_CUENTA_EN_MORA,
    );

    // Con su aviso, y uno solo aunque el barrido se repita: la cuenta ya no esta en
    // un estado que pueda entrar en mora.
    await procesarPagos();
    expect(await morasDe(cuenta.id_cuenta_cobro)).toHaveLength(1);
  });

  test('abono parcial DESPUES de la mora: sigue en mora', async () => {
    const { propietario: duenio, idContrato } = escenario();
    const cuenta = await cuentaConCorteHace(idContrato, 10);

    await procesarPagos();
    expect((await CuentaCobro.findByPk(cuenta.id_cuenta_cobro))!.estado).toBe(
      ESTADO_CUENTA_EN_MORA,
    );

    // `estadoSegunSaldo` hace ganar EN_MORA sobre PARCIAL: abonar la mitad de una
    // cuenta vencida no la pone al dia.
    const abono = await abonar(duenio.token, cuenta.id_cuenta_cobro, 400);
    expect(abono.statusCode).toBe(201);
    expect(abono.body.cuenta_cobro.estado).toBe(ESTADO_CUENTA_EN_MORA);
    expect(parseFloat(abono.body.cuenta_cobro.saldo_pendiente)).toBe(600);

    await procesarPagos();
    expect((await CuentaCobro.findByPk(cuenta.id_cuenta_cobro))!.estado).toBe(
      ESTADO_CUENTA_EN_MORA,
    );
    expect(await morasDe(cuenta.id_cuenta_cobro)).toHaveLength(1);
  });

  test('una cuenta saldada por completo no entra en mora nunca', async () => {
    const { propietario: duenio, idContrato } = escenario();
    const cuenta = await cuentaConCorteHace(idContrato, 3);

    expect((await abonar(duenio.token, cuenta.id_cuenta_cobro, 400)).statusCode).toBe(201);
    const saldo = await abonar(duenio.token, cuenta.id_cuenta_cobro, 600);
    expect(saldo.body.cuenta_cobro.estado).toBe(ESTADO_CUENTA_PAGADA);

    // Un mes despues del corte.
    await cuenta.update({ inicio: sumarDias(hoyEnZonaNegocio(), -30) });
    await procesarPagos();

    expect((await CuentaCobro.findByPk(cuenta.id_cuenta_cobro))!.estado).toBe(
      ESTADO_CUENTA_PAGADA,
    );
    expect(await morasDe(cuenta.id_cuenta_cobro)).toHaveLength(0);
  });

  test('el aviso previo tambien llega a una cuenta PARCIAL', async () => {
    const { propietario: duenio, idContrato } = escenario();
    const cuenta = await cuentaConCorteHace(idContrato, DIAS_AVISO_PREVIO);

    await abonar(duenio.token, cuenta.id_cuenta_cobro, 400);
    await procesarPagos();

    const avisos = (await eventosDeSalida('CuentaCobroPorVencer')).filter(
      (evento) => evento.payload['id_cuenta_cobro'] === cuenta.id_cuenta_cobro,
    );
    expect(avisos).toHaveLength(1);
    expect((await CuentaCobro.findByPk(cuenta.id_cuenta_cobro))!.estado).toBe(
      ESTADO_CUENTA_PARCIAL,
    );
  });
});

describe('Un numero fijo de viajes por barrido', () => {
  jest.setTimeout(20000);

  /** Peticiones a `/interno/contratos` en el ultimo tramo. */
  const consultasAContratos = () =>
    contratosFalso().llamadas.filter((l) => l.ruta.startsWith('/interno/contratos'));

  /** Peticiones a `/interno/usuarios` en el ultimo tramo. */
  const consultasAIdentidad = () =>
    identidadFalsa().llamadas.filter((l) => l.ruta.startsWith('/interno/usuarios'));

  test('procesarContratos: UNA petición, y el inmueble viene dentro', async () => {
    // UNA, y no dos. Eran contratos + inmuebles + identidad en el gateway, contratos +
    // identidad en el 6e, y desde el paso 7 sólo contratos: la que sobraba era la de
    // ms-identidad, a por las direcciones de correo. Los eventos llevan el `id_usuario`
    // y quien resuelve el destinatario es ms-notificaciones, así que el barrido no tiene
    // nada que preguntarle a identidad.
    //
    // Una regla que existía por propiedad del dato resulta que también le quita un salto
    // de red al proceso más pesado del sistema.
    contratosFalso().limpiarLlamadas();
    identidadFalsa().limpiarLlamadas();

    await procesarContratos();

    expect(consultasAContratos()).toHaveLength(1);
    expect(consultasAIdentidad()).toHaveLength(0);

    // Y la petición pide el inmueble: si no lo hiciera, los avisos no podrían llevar la
    // dirección ni el propietario, y eso se vería en un correo sin asunto claro.
    expect(consultasAContratos()[0]!.ruta).toContain('incluir=inmueble');
  });

  test('y el numero NO crece con el numero de contratos', async () => {
    // Lo anterior pasaria igual con un solo contrato, que es como se cuela un
    // N+1: la prueba no lo veria. Con varios, un `await` dentro del bucle se
    // delata.
    const duenio = propietario();
    const idInquilino = usuarioDe(['INQUILINO']);

    for (let i = 0; i < 5; i += 1) {
      contratoEnElDoble({
        id_inmueble: inmuebleDe(duenio.sub, `Multiple ${i}`),
        id_inquilino: idInquilino,
        fecha_inicio_corte: '2026-01-01',
      });
    }

    contratosFalso().limpiarLlamadas();
    identidadFalsa().limpiarLlamadas();

    await procesarContratos();

    expect(consultasAContratos()).toHaveLength(1);
    expect(consultasAIdentidad()).toHaveLength(0);
  });

  test('procesarPagos tambien pide los contratos en lote', async () => {
    // El otro barrido. Los contratos de todas las cuentas vencidas en UNA
    // peticion, por identificador.
    contratosFalso().limpiarLlamadas();
    identidadFalsa().limpiarLlamadas();

    await procesarPagos();

    expect(consultasAContratos().length).toBeLessThanOrEqual(1);
    expect(consultasAIdentidad()).toHaveLength(0);
  });

  test('el motor NO habla con ms-identidad en ningún barrido', async () => {
    // La afirmación en su forma más fuerte, y es una garantía nueva del paso 7. Hasta
    // aquí el barrido dependía de ms-identidad para conseguir direcciones de correo, y
    // esa dependencia había que documentarla como «degrada si no responde». Ya no
    // existe: los eventos llevan identificadores y el destinatario lo resuelve otro.
    contratosFalso().limpiarLlamadas();
    identidadFalsa().limpiarLlamadas();

    await procesarContratos();
    await procesarPagos();

    expect(identidadFalsa().llamadas).toHaveLength(0);
  });
});

describe('Politica de fallo del motor', () => {
  jest.setTimeout(20000);

  test('si ms-contratos no responde, el barrido no genera nada y no revienta', async () => {
    // Un fallo de ms-contratos SI para la generacion: sin la lista, no hay nada
    // que facturar, y generar la mitad de las cuentas del mes seria peor que no
    // generar ninguna. Lo que no puede es tirar el proceso — el motor corre en un
    // `cron`, y una excepcion sin capturar se lleva por delante el barrido de
    // mora que viene detras.
    contratosFalso().caer(503);

    await expect(procesarContratos()).resolves.not.toThrow();
    await expect(procesarPagos()).resolves.not.toThrow();

    contratosFalso().levantar();
  });

  test('si ms-identidad no responde, al motor le da igual', async () => {
    // ── ESTA PRUEBA CAMBIA DE SENTIDO EN EL PASO 7 ─────────────────────────
    //
    // Decía «el motor sigue haciendo su trabajo»: generar cuentas y marcar mora era lo
    // principal y avisar lo accesorio, así que un fallo de identidad no podía parar lo
    // uno por lo otro. Era una prueba sobre una DEGRADACIÓN.
    //
    // Ahora no hay nada que degradar, porque el motor no llama a ms-identidad. La
    // prueba se queda porque la afirmación sigue valiendo —y de hecho es más fuerte—
    // pero lo que comprueba es que la dependencia ya no existe: el barrido funciona con
    // identidad caída no porque lo tolere, sino porque no la necesita.
    const { idContrato } = escenario();
    const haceSieteDias = sumarDias(hoyEnZonaNegocio(), -7);

    const cuenta = await CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'Canon vencido sin identidad',
      valor: 1000,
      inicio: haceSieteDias,
      fin: sumarDias(haceSieteDias, 29),
      estado: ESTADO_CUENTA_PENDIENTE,
    });

    identidadFalsa().caer(503);

    await expect(procesarPagos()).resolves.not.toThrow();

    // Y la mora SI se marco, que es lo que esta prueba defiende.
    const actualizada = await CuentaCobro.findByPk(cuenta.id_cuenta_cobro);
    expect(actualizada!.estado).toBe(ESTADO_CUENTA_EN_MORA);

    identidadFalsa().levantar();
  });
});

describe('El motor AVISA con eventos, no con correos', () => {
  jest.setTimeout(20000);

  /**
   * ── QUE SE COMPRUEBA AQUI, Y POR QUE NO SE PODIA COMPROBAR ANTES ──────────
   *
   * Hasta el paso 7 los cuatro avisos del motor eran llamadas a `enviarCorreo`, que
   * se tragaba los fallos con un `console.error`. No habia nada que afirmar: ni que
   * el aviso hubiera salido, ni a quien, ni con que datos. Una suite verde era
   * compatible con un motor que no avisaba a nadie.
   *
   * Ahora cada aviso es una fila en `financiero.eventos_salida`, con su carga. Eso es
   * lo que hace estas pruebas posibles, y es un argumento a favor del cambio que no
   * estaba en la lista: un aviso que se puede comprobar es un aviso que se puede
   * mantener.
   */

  test('generar una cuenta de cobro emite CuentaCobroGenerada con su destinatario', async () => {
    // El mismo patrón que el resto de la suite: el corte cae dentro de la ventana de dos
    // días, y se pone un año atrás para que el periodo que toca facturar NO sea el
    // primero — el primero es del consumidor del evento y el barrido lo salta siempre.
    const pasadoManana = sumarDias(hoyEnZonaNegocio(), 2);
    const { idContrato, inquilino: arrendatario } = escenario({
      fecha_inicio_corte: sumarDias(pasadoManana, -365),
      canon: 1234000,
    });

    await procesarContratos();

    const cuenta = await CuentaCobro.findOne({
      where: { id_contrato: idContrato },
      order: [['inicio', 'DESC']],
    });
    expect(cuenta).not.toBeNull();

    const eventos = await eventosDeSalida('CuentaCobroGenerada');
    const suyo = eventos.find((e) => e.payload['id_cuenta_cobro'] === cuenta!.id_cuenta_cobro);

    expect(suyo).toBeDefined();
    // El destinatario va como IDENTIFICADOR, no como correo: un correo pertenece a
    // identidad.usuarios y a nadie mas.
    expect(suyo!.payload['id_inquilino']).toBe(arrendatario.sub);
    expect(JSON.stringify(suyo!.payload)).not.toContain('@');
    // Y el periodo completo, no un dia del mes suelto como decia el correo anterior.
    expect(suyo!.payload['inicio']).toBe(cuenta!.inicio);
    expect(suyo!.payload['fin']).toBe(cuenta!.fin);
    expect(Number(suyo!.payload['valor'])).toBe(1234000);
    // Ordena por cuenta de cobro: los avisos de UNA cuenta cuentan una historia.
    expect(suyo!.clave_orden).toBe(cuenta!.id_cuenta_cobro);
  });

  test('no hay aviso sin su cuenta de cobro: van en la misma transacción', async () => {
    // La correspondencia comprobable sin inyectar un fallo, y en la dirección que
    // importa: si la transacción no fuera una, podría quedar un evento anunciando una
    // cuenta que el ROLLBACK se llevó — es decir, un correo que le dice a alguien que
    // tiene una factura que no existe.
    //
    // La dirección contraria no se comprueba aquí sobre TODAS las filas a propósito:
    // varias pruebas de esta suite crean cuentas con `CuentaCobro.create` directamente,
    // sin pasar por `emitirCuentaCobro`, para montar escenarios de mora. Ésas no tienen
    // aviso y no deben tenerlo.
    const eventos = await eventosDeSalida('CuentaCobroGenerada');
    expect(eventos.length).toBeGreaterThan(0);

    for (const evento of eventos) {
      const id = evento.payload['id_cuenta_cobro'] as string;
      expect(await CuentaCobro.findByPk(id)).not.toBeNull();
    }
  });

  test('la mora emite CuentaCobroEnMora a las DOS partes, con la dirección', async () => {
    const { idContrato, inquilino: arrendatario, propietario: duenio } = escenario();
    const haceSieteDias = sumarDias(hoyEnZonaNegocio(), -7);

    const cuenta = await CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'Canon con mora anunciada',
      valor: 800000,
      inicio: haceSieteDias,
      fin: sumarDias(haceSieteDias, 29),
      estado: ESTADO_CUENTA_PENDIENTE,
    });

    await procesarPagos();

    // El cambio de estado ocurrio...
    const actualizada = await CuentaCobro.findByPk(cuenta.id_cuenta_cobro);
    expect(actualizada!.estado).toBe(ESTADO_CUENTA_EN_MORA);

    // ...y su aviso tambien, en la misma transaccion. No puede haber una mora sin aviso
    // ni un aviso sin mora.
    const eventos = await eventosDeSalida('CuentaCobroEnMora');
    const suyo = eventos.find((e) => e.payload['id_cuenta_cobro'] === cuenta.id_cuenta_cobro);

    expect(suyo).toBeDefined();
    // UN evento para las DOS partes: decidir que al inquilino se le habla de «tu pago» y
    // al propietario de «el pago del inmueble X» es de ms-notificaciones.
    expect(suyo!.payload['id_inquilino']).toBe(arrendatario.sub);
    expect(suyo!.payload['id_propietario']).toBe(duenio.sub);
    // La direccion SI viaja: es el ASUNTO del mensaje, no un dato de contacto.
    expect(suyo!.payload['direccion_inmueble']).toBe('Calle 123 #45-67');
    expect(suyo!.payload['dias_de_mora']).toBe(7);
  });

  test('un segundo barrido no vuelve a anunciar la misma mora', async () => {
    // El estado de la cuenta hace de bitacora: la condicion exige que venga de
    // PENDIENTE, asi que una segunda pasada no cambia el estado y no anota el evento.
    // Sin eso, un barrido repetido mandaria el mismo correo de mora otra vez — y un
    // correo no se puede recoger.
    const antes = (await eventosDeSalida('CuentaCobroEnMora')).length;

    await procesarPagos();

    expect((await eventosDeSalida('CuentaCobroEnMora')).length).toBe(antes);
  });

  test('el aviso previo emite CuentaCobroPorVencer con la FECHA de la mora', async () => {
    const { idContrato } = escenario();
    // DIAS_AVISO_PREVIO es 4: el aviso sale el cuarto dia desde el corte.
    const corte = sumarDias(hoyEnZonaNegocio(), -DIAS_AVISO_PREVIO);

    const cuenta = await CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'Canon por vencer',
      valor: 500000,
      inicio: corte,
      fin: sumarDias(corte, 29),
      estado: ESTADO_CUENTA_PENDIENTE,
    });

    await procesarPagos();

    const eventos = await eventosDeSalida('CuentaCobroPorVencer');
    const suyo = eventos.find((e) => e.payload['id_cuenta_cobro'] === cuenta.id_cuenta_cobro);

    expect(suyo).toBeDefined();
    // Una FECHA y no «mañana»: el correo anterior decia «tienes hasta mañana», que era
    // cierto en el instante del sendMail porque el envio iba dentro del barrido. Con el
    // bus hay una ventana que los reintentos estiran, y una frase relativa se vuelve
    // falsa sola.
    expect(suyo!.payload['entra_en_mora_el']).toBe(sumarDias(corte, DIAS_PARA_MORA));

    // Y esta cuenta NO se marco en mora: el aviso previo no cambia nada en la base.
    const actualizada = await CuentaCobro.findByPk(cuenta.id_cuenta_cobro);
    expect(actualizada!.estado).toBe(ESTADO_CUENTA_PENDIENTE);
  });

  test('ningún evento del motor lleva una dirección de correo', async () => {
    // La regla, comprobada sobre TODO lo que el motor ha emitido en esta suite. Es la
    // forma de atrapar a quien añada `email` a una carga «porque ya lo tenia a mano».
    const todos = [
      ...(await eventosDeSalida('CuentaCobroGenerada')),
      ...(await eventosDeSalida('CuentaCobroPorVencer')),
      ...(await eventosDeSalida('CuentaCobroEnMora')),
    ];

    expect(todos.length).toBeGreaterThan(0);

    for (const evento of todos) {
      const texto = JSON.stringify(evento.payload);
      expect(texto).not.toContain('@');
      expect(evento.payload['email']).toBeUndefined();
      expect(evento.payload['destinatario']).toBeUndefined();
    }
  });
});
