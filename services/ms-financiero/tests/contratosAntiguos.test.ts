/**
 * Un contrato que ya corría al registrarlo: se factura desde el mes siguiente al último
 * pagado. El consumidor emite lo que ya tocaba al formalizar y el motor, lo que venga después.
 */

import request from 'supertest';
import { cuentasPendientes } from 'arriendos360-contracts';
import {
  TIPO_CONTRATO_FORMALIZADO,
  comoISO,
  crearSobre,
  hoyEnZonaNegocio,
  partesDeISO,
  periodosPendientes,
  sumarDias,
} from 'arriendos360-shared';

import { CuentaCobro } from '../src/models/CuentaCobro';
import { ESTADO_CUENTA_EN_MORA, ESTADO_CUENTA_PENDIENTE } from '../src/models/constantes';
import { procesarContratos, procesarPagos } from '../src/services/motor';
import { app, cerrarEntorno, conToken, entregarEvento, escenario, eventosDeSalida, prepararEntorno } from './utiles/entorno';

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

const cuentasDe = (idContrato: string) =>
  CuentaCobro.findAll({ where: { id_contrato: idContrato }, order: [['inicio', 'ASC']] });

/** El corte de un contrato de 2020 que cae en `fecha`: enero tiene todos los días. */
const corteAntiguoEn = (fecha: string): string => comoISO(2020, 0, partesDeISO(fecha).dia);

const hoy = hoyEnZonaNegocio();

/** El día 1 del mes anterior al de `fecha`: un último pagado sólo se lee por su mes. */
const mesAntes = (fecha: string): string => {
  const { anio, mes } = partesDeISO(fecha);
  return mes === 0 ? comoISO(anio - 1, 11, 1) : comoISO(anio, mes - 1, 1);
};

const avisosDeContrato = async (tipo: string, idContrato: string) =>
  (await eventosDeSalida(tipo)).filter((evento) => evento.payload['id_contrato'] === idContrato);

describe('El consumidor emite desde el mes siguiente al último pagado', () => {
  // Día 1: el corte de este mes ya llegó, cualquiera que sea hoy.
  const { anio, mes } = partesDeISO(hoy);
  const ultimoPagado = comoISO(mes < 3 ? anio - 1 : anio, (mes + 9) % 12, 1);

  const formalizar = (idContrato: string, idInmueble: string, idInquilino: string, ultimo = ultimoPagado) =>
    entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1500000,
      fecha_inicio_corte: '2020-02-01',
      id_inquilino: idInquilino,
      ultimo_periodo_pagado: ultimo,
    });

  test('una cuenta PENDIENTE por periodo, con el canon vigente y nada hasta el último pagado', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();

    const { respuesta } = await formalizar(idContrato, idInmueble, inquilino.sub);

    expect(respuesta.statusCode).toBe(200);
    const cuentas = await cuentasDe(idContrato);
    const esperados = periodosPendientes(1, ultimoPagado, hoy).map((periodo) => periodo.inicio);
    expect(esperados.length).toBeGreaterThanOrEqual(3);
    expect(cuentas.map((cuenta) => cuenta.inicio)).toEqual(esperados);
    expect(cuentas.every((cuenta) => cuenta.estado === ESTADO_CUENTA_PENDIENTE)).toBe(true);
    expect(cuentas.every((cuenta) => Number(cuenta.valor) === 1500000)).toBe(true);

  });

  test('las atrasadas no llevan recibo: un solo resumen al inquilino, con su total y su rango', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();

    await formalizar(idContrato, idInmueble, inquilino.sub);

    const periodos = periodosPendientes(1, ultimoPagado, hoy);
    const atrasadas = periodos.filter(({ inicio }) => sumarDias(inicio, 6) <= hoy);
    expect(atrasadas.length).toBeGreaterThanOrEqual(2);

    const resumenes = await avisosDeContrato('CuentasAtrasadasRegistradas', idContrato);
    expect(resumenes.map((evento) => evento.payload)).toEqual([
      {
        id_contrato: idContrato,
        id_inquilino: inquilino.sub,
        cantidad: atrasadas.length,
        total: 1500000 * atrasadas.length,
        primer_periodo: atrasadas[0]!.inicio,
        ultimo_periodo: atrasadas.at(-1)!.fin,
      },
    ]);
    expect(await avisosDeContrato('CuentaCobroGenerada', idContrato)).toHaveLength(periodos.length - atrasadas.length);
  });

  test('una cuenta aún en plazo lleva su recibo, junto al resumen de las atrasadas', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1500000,
      fecha_inicio_corte: corteAntiguoEn(hoy),
      id_inquilino: inquilino.sub,
      ultimo_periodo_pagado: mesAntes(mesAntes(hoy)),
    });

    const recibos = await avisosDeContrato('CuentaCobroGenerada', idContrato);
    expect(recibos.map((evento) => evento.payload['inicio'])).toEqual([hoy]);
    expect(await avisosDeContrato('CuentasAtrasadasRegistradas', idContrato)).toHaveLength(1);
  });

  test('sin atrasadas no hay resumen', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();

    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1500000,
      fecha_inicio_corte: corteAntiguoEn(hoy),
      id_inquilino: inquilino.sub,
      ultimo_periodo_pagado: mesAntes(hoy),
    });

    expect(await avisosDeContrato('CuentaCobroGenerada', idContrato)).toHaveLength(1);
    expect(await avisosDeContrato('CuentasAtrasadasRegistradas', idContrato)).toHaveLength(0);
  });

  test('atrasada se mide el día de la firma, no el día en que llegó el evento', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();
    const corte = sumarDias(hoy, -7);
    const payload = {
      id_contrato: idContrato,
      id_inmueble: idInmueble,
      canon: 1500000,
      fecha_inicio_corte: corteAntiguoEn(corte),
      id_inquilino: inquilino.sub,
      ultimo_periodo_pagado: mesAntes(corte),
    };

    // Firmado a los 4 días del corte; el evento llega a los 7.
    const firma = new Date(`${sumarDias(hoy, -3)}T17:00:00Z`);
    await entregarEvento(TIPO_CONTRATO_FORMALIZADO, payload, crearSobre(TIPO_CONTRATO_FORMALIZADO, payload, { ocurrido_en: firma }));

    const recibos = await avisosDeContrato('CuentaCobroGenerada', idContrato);
    expect(recibos.map((evento) => evento.payload['inicio'])).toContain(corte);
    expect(await avisosDeContrato('CuentasAtrasadasRegistradas', idContrato)).toHaveLength(0);
  });

  test('al día con los pagos no crea ninguna', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();

    const { respuesta } = await formalizar(idContrato, idInmueble, inquilino.sub, sumarDias(hoy, 40));

    expect(respuesta.statusCode).toBe(200);
    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('el mismo evento dos veces no duplica', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();

    const { sobre } = await formalizar(idContrato, idInmueble, inquilino.sub);
    const antes = (await cuentasDe(idContrato)).length;
    const repetido = await entregarEvento(TIPO_CONTRATO_FORMALIZADO, sobre.payload, sobre);

    expect(repetido.respuesta.body.repetido).toBe(true);
    expect(await cuentasDe(idContrato)).toHaveLength(antes);
    expect(await avisosDeContrato('CuentasAtrasadasRegistradas', idContrato)).toHaveLength(1);
  });

  test('si el motor ya emitió alguna, emite las demás sin chocar con el índice', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();
    const esperados = periodosPendientes(1, ultimoPagado, hoy);
    const ultima = esperados.at(-1)!;
    await CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'Del motor',
      valor: 1500000,
      inicio: ultima.inicio,
      fin: ultima.fin,
      estado: ESTADO_CUENTA_PENDIENTE,
    } as never);

    const { respuesta } = await formalizar(idContrato, idInmueble, inquilino.sub);

    expect(respuesta.statusCode).toBe(200);
    expect(await cuentasDe(idContrato)).toHaveLength(esperados.length);
  });

  test('un último pagado que no es fecha se rechaza y no crea nada', async () => {
    const { idContrato, idInmueble, inquilino } = escenario();

    const { respuesta } = await formalizar(idContrato, idInmueble, inquilino.sub, 'nunca');

    expect(respuesta.statusCode).toBe(500);
    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('las atrasadas entran en mora con la regla normal, sin aviso de mora ni de «por vencer»', async () => {
    const { idContrato, idInmueble, inquilino } = escenario({
      fecha_inicio_corte: '2020-02-01',
      ultimo_periodo_pagado: ultimoPagado,
      fecha_creacion: `${hoy}T17:00:00Z`,
    });
    await formalizar(idContrato, idInmueble, inquilino.sub);
    const vencidas = (await cuentasDe(idContrato)).filter((cuenta) => sumarDias(cuenta.inicio as string, 6) <= hoy);
    expect(vencidas.length).toBeGreaterThanOrEqual(2);

    await procesarPagos();
    await procesarPagos();

    const despues = await cuentasDe(idContrato);
    const enMora = despues.filter((cuenta) => cuenta.estado === ESTADO_CUENTA_EN_MORA);
    expect(enMora.map((cuenta) => cuenta.inicio)).toEqual(vencidas.map((cuenta) => cuenta.inicio));

    const avisosDe = async (tipo: string) =>
      (await eventosDeSalida(tipo)).filter(
        (evento) => evento.payload['id_contrato'] === idContrato && enMora.some((c) => c.inicio === evento.payload['inicio']),
      );
    expect(await avisosDe('CuentaCobroEnMora')).toHaveLength(0);
    expect(await avisosDe('CuentaCobroPorVencer')).toHaveLength(0);
  });

  test.each([
    ['la creada a mano de un periodo ya pagado', 0, -40],
    ['la posterior a la firma', -31, -20],
  ])('%s sí avisa de su mora', async (_caso, pagadoDesdeElCorte, diasFirma) => {
    const inicio = sumarDias(hoy, -10);
    const pagado = sumarDias(inicio, pagadoDesdeElCorte);
    const { idContrato } = escenario({
      fecha_inicio_corte: '2020-02-01',
      ultimo_periodo_pagado: pagado,
      fecha_creacion: `${sumarDias(hoy, diasFirma)}T17:00:00Z`,
    });
    await CuentaCobro.create({
      id_contrato: idContrato,
      detalle: 'A mano',
      valor: 1500000,
      inicio,
      fin: sumarDias(inicio, 29),
      estado: ESTADO_CUENTA_PENDIENTE,
    } as never);

    await procesarPagos();

    expect(await avisosDeContrato('CuentaCobroEnMora', idContrato)).toHaveLength(1);
  });
});

describe('El motor con un último periodo pagado', () => {
  // Un corte a dos días: el motor ya lo tiene en su ventana.
  const corte = sumarDias(hoy, 2);
  const haceUnMes = `${sumarDias(hoy, -30)}T12:00:00Z`;
  const fecha_inicio_corte = corteAntiguoEn(corte);

  test('no cobra el periodo ya pagado', async () => {
    const { idContrato } = escenario({ fecha_inicio_corte, ultimo_periodo_pagado: corte, fecha_creacion: haceUnMes });

    await procesarContratos();

    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('tampoco uno pagado por adelantado', async () => {
    const { idContrato } = escenario({
      fecha_inicio_corte,
      ultimo_periodo_pagado: sumarDias(corte, 31),
      fecha_creacion: haceUnMes,
    });

    await procesarContratos();

    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('al día al formalizar: el siguiente, que al consumidor no le tocó, lo factura el motor', async () => {
    const { idContrato } = escenario({
      fecha_inicio_corte,
      ultimo_periodo_pagado: sumarDias(corte, -31),
      fecha_creacion: haceUnMes,
    });

    await procesarContratos();
    await procesarContratos();

    const cuentas = await cuentasDe(idContrato);
    expect(cuentas.map((cuenta) => cuenta.inicio)).toEqual([corte]);
  });

  test('salta lo que ya tocaba al formalizar: es del consumidor, cuyo evento aún no llega', async () => {
    const { idContrato } = escenario({
      fecha_inicio_corte,
      ultimo_periodo_pagado: sumarDias(corte, -31),
      fecha_creacion: `${hoy}T17:00:00Z`,
    });

    await procesarContratos();

    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('«ya tocaba» se mide en Bogotá: firmar de noche no le quita el periodo al motor', async () => {
    // 21:00 en Bogotá del día `corte - 3`: en UTC ya es `corte - 2`, y sumando la anticipación parecería suyo.
    const { idContrato } = escenario({
      fecha_inicio_corte,
      ultimo_periodo_pagado: sumarDias(corte, -31),
      fecha_creacion: `${sumarDias(corte, -2)}T02:00:00Z`,
    });

    await procesarContratos();

    expect((await cuentasDe(idContrato)).map((cuenta) => cuenta.inicio)).toEqual([corte]);
  });

  test('un contrato sin el dato se salta su primer periodo, como siempre', async () => {
    const { idContrato } = escenario({ fecha_inicio_corte: corte });

    await procesarContratos();

    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });
});

describe('«Nuevo cobro» de un periodo ya pagado', () => {
  // Un corte a dos días: es el periodo que toca hoy.
  const corte = sumarDias(hoy, 2);
  const fecha_inicio_corte = corteAntiguoEn(corte);
  const cobrar = (token: string, idContrato: string, extra: Record<string, unknown> = {}) =>
    request(app)
      .post('/api/pagos/cuentas-cobro')
      .set(...conToken(token))
      .send({ id_contrato: idContrato, valor: 1500000, ...extra });

  test('sin indicar el periodo: 409 y ninguna cuenta', async () => {
    const { idContrato, propietario } = escenario({ fecha_inicio_corte, ultimo_periodo_pagado: corte });

    const respuesta = await cobrar(propietario.token, idContrato);

    expect(respuesta.status).toBe(409);
    expect(await cuentasDe(idContrato)).toHaveLength(0);
  });

  test('indicándolo se permite', async () => {
    const { idContrato, propietario } = escenario({ fecha_inicio_corte, ultimo_periodo_pagado: corte });

    const respuesta = await cobrar(propietario.token, idContrato, { inicio: corte });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.cuenta_cobro.inicio).toBe(corte);
  });

  test('sin indicarlo, un periodo posterior al último pagado se cobra', async () => {
    const { idContrato, propietario } = escenario({ fecha_inicio_corte, ultimo_periodo_pagado: mesAntes(corte) });

    expect((await cobrar(propietario.token, idContrato)).status).toBe(201);
  });

  test('un contrato terminado cobra sin periodo, como siempre', async () => {
    const { idContrato, propietario } = escenario({ fecha_inicio_corte, ultimo_periodo_pagado: corte, estado: 'cancelado' });

    const respuesta = await cobrar(propietario.token, idContrato);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.cuenta_cobro.inicio).toBeNull();
  });
});

describe('La SPA anuncia las mismas cuentas que el consumidor crea', () => {
  test('`cuentasPendientes` coincide con `periodosPendientes`', () => {
    for (const dia of [1, 15, 28, 29, 30, 31]) {
      for (let desplazamiento = 0; desplazamiento < 400; desplazamiento += 3) {
        const futuro = sumarDias('2027-12-20', desplazamiento);
        const ultimoMes = '2027-10';
        const inicio = comoISO(2027, 9, Math.min(dia, 31));

        expect(cuentasPendientes(dia, ultimoMes, futuro)).toEqual(
          periodosPendientes(dia, inicio, futuro).map((periodo) => ({ inicio: periodo.inicio, fin: periodo.fin })),
        );
      }
    }
  });
});
