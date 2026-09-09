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
 * La tercera cambia de numero: eran TRES peticiones cuando esto vivia en el
 * gateway (contratos, inmuebles, identidad) y ahora son DOS, porque el inmueble
 * viaja dentro del contrato. Lo que no cambia es lo que la prueba defiende: que
 * el numero NO crece con el numero de contratos.
 *
 * ── Y LAS FECHAS SON DETERMINISTAS ─────────────────────────────────────────
 *
 * El motor pregunta que dia es en `America/Bogota`, que es la zona del negocio,
 * y esta suite parte de ESE MISMO dia. La consecuencia es que dice lo mismo a
 * las 02:00 que a las 23:00, y en un contenedor en UTC que en un portatil en
 * Bogota.
 */

import { TIPO_CONTRATO_FORMALIZADO } from 'arriendos360-shared';
import { hoyEnZonaNegocio } from 'arriendos360-shared';

import { CuentaCobro } from '../src/models/CuentaCobro';
import {
  ESTADO_CUENTA_EN_MORA,
  ESTADO_CUENTA_PARCIAL,
  ESTADO_CUENTA_PENDIENTE,
  USUARIO_SISTEMA,
} from '../src/models/constantes';
import { procesarContratos, procesarPagos } from '../src/services/motor';
import {
  cerrarEntorno,
  contratoEnElDoble,
  contratosFalso,
  entregarEvento,
  escenario,
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
    const { idContrato, idInmueble } = escenario({ fecha_inicio_corte: pasadoManana });

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1000,
      fecha_inicio_corte: pasadoManana,
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

  test('una cuenta PARCIAL no entra en mora por este camino', async () => {
    // Es lo que hacia el motor antes de la extraccion y lo que sigue haciendo:
    // barre PENDIENTE y EN_MORA, no PARCIAL. Una cuenta con algo abonado no se
    // marca en mora aqui.
    const { idContrato } = escenario();
    const haceDiezDias = sumarDias(hoyEnZonaNegocio(), -10);

    const cuenta = await CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'Canon abonado a medias',
      valor: 1000,
      inicio: haceDiezDias,
      fin: sumarDias(haceDiezDias, 29),
      estado: ESTADO_CUENTA_PARCIAL,
    });

    await procesarPagos();

    const actualizada = await CuentaCobro.findByPk(cuenta.id_cuenta_cobro);
    expect(actualizada!.estado).toBe(ESTADO_CUENTA_PARCIAL);
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

  test('procesarContratos: DOS peticiones, y el inmueble viene dentro', async () => {
    // DOS y no tres. Antes de la extraccion eran contratos + inmuebles +
    // identidad; ahora el inmueble viaja dentro del contrato porque se pide con
    // `incluir=inmueble`, y ese salto encadenado lo da ms-contratos.
    contratosFalso().limpiarLlamadas();
    identidadFalsa().limpiarLlamadas();

    await procesarContratos();

    expect(consultasAContratos()).toHaveLength(1);
    expect(consultasAIdentidad()).toHaveLength(1);

    // Y la peticion pide el inmueble: si no lo hiciera, el motor no sabria a que
    // propietario avisar y la degradacion pasaria inadvertida.
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
    expect(consultasAIdentidad()).toHaveLength(1);
  });

  test('procesarPagos tambien pide los contratos en lote', async () => {
    // El otro barrido. Los contratos de todas las cuentas vencidas en UNA
    // peticion, por identificador.
    contratosFalso().limpiarLlamadas();
    identidadFalsa().limpiarLlamadas();

    await procesarPagos();

    expect(consultasAContratos().length).toBeLessThanOrEqual(1);
    expect(consultasAIdentidad().length).toBeLessThanOrEqual(1);
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

  test('si ms-identidad no responde, el motor sigue haciendo su trabajo', async () => {
    // Generar cuentas de cobro y marcar mora es lo principal; avisar por correo
    // es lo accesorio. Un fallo de identidad no puede parar lo uno por lo otro.
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
