/**
 * Cuentas de cobro, transacciones y sus PDF.
 *
 * Cada handler comprueba que el recurso sea del usuario: se ve si es dueño del
 * inmueble o inquilino del contrato (lo resuelve ms-contratos), y se escribe sólo
 * si es el dueño. Si ms-contratos no responde, 502, nunca 403.
 */

import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import PDFDocument from 'pdfkit';
import { TIPOS_TRANSACCION } from 'arriendos360-contracts';
import {
  crearError,
  diaDeCorte,
  diasEntre,
  hoyEnZonaNegocio,
  periodoQueEmpiezaEn,
  soloFecha,
} from 'arriendos360-shared';

import {
  contratosDePropietario,
  idsDondeEsParte,
  parteDe,
  porId as contratoPorId,
  propioDe as contratoPropioDe,
} from '../clientes/contratos';
import { CuentaCobro } from '../models/CuentaCobro';
import { Transaccion } from '../models/Transaccion';
import {
  ESTADO_CUENTA_EN_MORA,
  ESTADO_CUENTA_PAGADA,
  ESTADO_CUENTA_PARCIAL,
  ESTADO_CUENTA_PENDIENTE,
  ESTADO_TRANSACCION_ANULADA,
  ESTADO_TRANSACCION_CONFIRMADA,
  TIPO_TRANSACCION_INGRESO,
} from '../models/constantes';
import { esUuid } from '../models/uuid';
import { emitirCuentaCobro } from '../services/cuentas';
import { adjuntarContratoACuentas, adjuntarContratoATransacciones, adjuntarInquilino } from '../services/composicion';
import { DIAS_PARA_MORA, ESTADOS_QUE_ENTRAN_EN_MORA, periodoAFacturar } from '../services/motor';
import { generarPDFComprobante } from '../services/pdfService';
import {
  conSaldo,
  conSaldoAnidado,
  conSaldos,
  estadoSegunSaldo,
  fechaPagoSegunSaldo,
  saldoDe,
} from '../services/saldos';

/** El `sub` del token, que el middleware ya verifico. */
const subDe = (req: Request): string => (req.usuario as { sub: string }).sub;

/** 502 cuando ms-contratos no responde. */
const responderServicioCaido = (res: Response, error: unknown, accion: string): Response => {
  console.error(`Error al ${accion}:`, (error as Error).message);
  return res.status(502).json(crearError('No se pudo contactar el servicio de contratos'));
};

/** ¿Este error viene de no poder hablar con ms-contratos? Separa un 502 de un 500. */
const esFalloDeContratos = (error: unknown): boolean => {
  const mensaje = (error as Error).message;
  return typeof mensaje === 'string' && mensaje.includes('ms-contratos');
};

/** Filtro por los contratos del usuario. */
const deMisContratos = (misContratos: string[]) => ({
  id_contrato: { [Op.in]: misContratos },
});

/** ¿Es esta cuenta de cobro de uno de mis contratos? */
const puedeVerCuenta = (cuenta: CuentaCobro, misContratos: string[]): boolean =>
  misContratos.includes(cuenta.id_contrato);

// ── Lecturas ────────────────────────────────────────────────────────────────

/** Todas las cuentas de cobro en las que el usuario es parte. */
export const obtenerTodos = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const misContratos = await idsDondeEsParte(subDe(req));

    const cuentas = await CuentaCobro.findAll({ where: deMisContratos(misContratos) });

    return res.json(await conSaldos(await adjuntarContratoACuentas(cuentas)));
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener cuentas de cobro');
  }
};

/** Cuentas de cobro de un contrato. */
export const obtenerPorContrato = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const idContrato = req.params['id_contrato'] as string;
    const sub = subDe(req);

    // ¿Es dueño del inmueble o inquilino? Lo responde ms-contratos.
    const contrato = esUuid(idContrato) ? await parteDe(idContrato, sub) : null;

    if (!contrato) {
      return res
        .status(403)
        .json(crearError('No tienes permisos para ver los pagos de este contrato'));
    }

    const cuentas = await CuentaCobro.findAll({
      where: { id_contrato: idContrato },
      order: [['inicio', 'ASC']],
    });

    return res.json(await conSaldos(await adjuntarContratoACuentas(cuentas)));
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener pagos del contrato');
  }
};

/** Cuentas PENDIENTE y PARCIAL del usuario. */
export const obtenerPendientes = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const misContratos = await idsDondeEsParte(subDe(req));

    const cuentas = await CuentaCobro.findAll({
      where: {
        estado: { [Op.in]: [ESTADO_CUENTA_PENDIENTE, ESTADO_CUENTA_PARCIAL] },
        ...deMisContratos(misContratos),
      },
      order: [['inicio', 'ASC']],
    });

    return res.json(await conSaldos(await adjuntarContratoACuentas(cuentas)));
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener pendientes');
  }
};

/** Historial global de transacciones del usuario. */
export const obtenerHistorialGlobal = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  try {
    const misContratos = await idsDondeEsParte(subDe(req));

    const transacciones = await Transaccion.findAll({
      where: { '$CuentaCobro.id_contrato$': { [Op.in]: misContratos } },
      include: [{ model: CuentaCobro, required: true }],
      order: [['fecha_pago', 'DESC']],
    });

    // El contrato y su inmueble se componen desde ms-contratos.
    const conContrato = await adjuntarContratoATransacciones(transacciones);

    return res.json(
      await conSaldoAnidado(
        conContrato,
        (fila) => fila['CuentaCobro'] as Record<string, unknown> | null,
      ),
    );
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener historial global');
  }
};

/** Las transacciones de una cuenta de cobro, incluidas las anuladas. */
export const obtenerTransacciones = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  try {
    const id = req.params['id'] as string;
    const cuenta = esUuid(id) ? await CuentaCobro.findByPk(id) : null;

    if (!cuenta) {
      return res.status(404).json(crearError('No encontrado'));
    }

    const misContratos = await idsDondeEsParte(subDe(req));
    if (!puedeVerCuenta(cuenta, misContratos)) {
      return res.status(403).json(crearError('No autorizado'));
    }

    // Incluye las anuladas.
    const transacciones = await Transaccion.findAll({
      where: { id_cuenta_cobro: id },
      order: [['fecha_pago', 'DESC']],
    });

    return res.json(transacciones);
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener transacciones');
  }
};

// ── Escrituras ──────────────────────────────────────────────────────────────

/**
 * Alta manual de una cuenta de cobro — `POST /api/pagos/cuentas-cobro`. Sin
 * periodo, se deriva del contrato con la misma función que el motor. Anota
 * `CuentaCobroGenerada`, como los demás caminos.
 */
export const crearCuentaCobro = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const sub = subDe(req);
    const { id_contrato, valor, detalle } = req.body as {
      id_contrato?: string;
      valor?: number;
      detalle?: string;
      inicio?: string;
      fin?: string;
    };

    // Cobrar es sólo del dueño del inmueble.
    const contrato =
      id_contrato && esUuid(id_contrato) ? await contratoPropioDe(id_contrato, sub) : null;

    if (!contrato) {
      return res.status(403).json(crearError('No tienes permisos sobre este contrato'));
    }

    const diaCorte = diaDeCorte(contrato.fecha_inicio_corte);
    const inicioPedido = soloFecha(req.body.inicio);

    // Con `inicio`, el `fin` se calcula con el día pactado del contrato.
    const periodo =
      inicioPedido && diaCorte !== null
        ? { ...periodoQueEmpiezaEn(inicioPedido, diaCorte), inicio: inicioPedido }
        : periodoAFacturar(diaCorte ?? 1, hoyEnZonaNegocio());

    const fin = soloFecha(req.body.fin) ?? periodo.fin;

    // El inquilino, para el evento, sale del contrato ya pedido.
    const { cuenta } = await emitirCuentaCobro({
      id_contrato: id_contrato as string,
      id_inquilino: contrato.id_inquilino,
      valor: valor as number,
      inicio: periodo.inicio,
      fin,
      detalle: detalle ?? `Canon de arrendamiento del ${periodo.inicio} al ${fin}`,
      auditor: sub,
    });

    return res.status(201).json({
      mensaje: 'Cuenta de cobro registrada exitosamente',
      cuenta_cobro: await conSaldo(cuenta),
    });
  } catch (error) {
    if (esFalloDeContratos(error)) {
      return responderServicioCaido(res, error, 'verificar el contrato');
    }

    return res.status(500).json({
      mensaje: 'Error al crear la cuenta de cobro',
      error: (error as Error).message,
    });
  }
};

/**
 * Registrar un pago — `POST /api/pagos`. Sin `tipo`, `INGRESO`. El saldo se lee
 * dentro de la transacción con la cuenta bloqueada, para que dos pagos
 * simultáneos no superen el saldo.
 */
export const registrarPago = async (req: Request, res: Response): Promise<Response | void> => {
  const sub = subDe(req);
  const { id_cuenta_cobro, monto, medio_pago, observaciones } = req.body as {
    id_cuenta_cobro?: string;
    monto?: number | string;
    medio_pago?: string;
    observaciones?: string;
    tipo?: string;
    fecha_pago?: string;
  };
  const tipo = req.body.tipo ?? TIPO_TRANSACCION_INGRESO;

  if (!(TIPOS_TRANSACCION as readonly string[]).includes(tipo)) {
    return res
      .status(400)
      .json(crearError(`El tipo de transacción debe ser uno de: ${TIPOS_TRANSACCION.join(', ')}`));
  }

  // La pertenencia (una llamada de red) se resuelve antes de bloquear la fila.
  let misContratos: string[];
  try {
    misContratos = await idsDondeEsParte(sub);
  } catch (error) {
    return responderServicioCaido(res, error, 'verificar el contrato');
  }

  const t = await CuentaCobro.sequelize!.transaction();
  try {
    const cuenta =
      id_cuenta_cobro && esUuid(id_cuenta_cobro)
        ? await CuentaCobro.findByPk(id_cuenta_cobro, { transaction: t })
        : null;

    if (!cuenta) {
      await t.rollback();
      return res.status(404).json(crearError('Cuenta de cobro no encontrada'));
    }

    // `FOR UPDATE` sobre la cuenta, en una consulta sin `include`.
    await CuentaCobro.findByPk(cuenta.id_cuenta_cobro, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const saldoActual = await saldoDe(cuenta, { transaction: t });

    if (parseFloat(String(monto)) <= 0 || parseFloat(String(monto)) > saldoActual) {
      await t.rollback();
      return res.status(400).json(crearError('Monto inválido o superior al saldo'));
    }

    if (!puedeVerCuenta(cuenta, misContratos)) {
      await t.rollback();
      return res.status(403).json(crearError('No autorizado'));
    }

    const nuevoSaldo = Math.round((saldoActual - parseFloat(String(monto))) * 100) / 100;
    const momento = req.body.fecha_pago ? new Date(req.body.fecha_pago) : new Date();

    const transaccion = await Transaccion.create(
      {
        id_cuenta_cobro: cuenta.id_cuenta_cobro,
        monto,
        tipo,
        medio_pago,
        observaciones,
        fecha_pago: momento,
        estado: ESTADO_TRANSACCION_CONFIRMADA,
        // Foto del saldo para el comprobante; no se vuelve a tocar.
        saldo_restante_momento: nuevoSaldo,
      },
      { transaction: t, usuarioAuditor: sub },
    );

    await cuenta.update(
      {
        fecha_pago: fechaPagoSegunSaldo(nuevoSaldo, momento),
        estado: estadoSegunSaldo(cuenta.valor, nuevoSaldo, cuenta.estado),
      },
      { transaction: t, usuarioAuditor: sub },
    );

    await t.commit();

    return res.status(201).json({
      mensaje:
        nuevoSaldo === 0 ? 'Pago completado exitosamente' : 'Pago parcial registrado exitosamente',
      cuenta_cobro: { ...cuenta.toJSON(), saldo_pendiente: nuevoSaldo },
      transaccion,
    });
  } catch (error) {
    await t.rollback();
    return res
      .status(500)
      .json({ mensaje: 'Error al registrar el pago', error: (error as Error).message });
  }
};

/**
 * Anular una transacción — `POST /api/pagos/transacciones/:id/anular`. No borra:
 * la pasa a `ANULADA` y recalcula el estado de la cuenta. Sólo el dueño del
 * inmueble; una ya anulada responde 409.
 */
export const anularTransaccion = async (req: Request, res: Response): Promise<Response | void> => {
  const idTransaccion = req.params['id_transaccion'] as string;
  const sub = subDe(req);

  const t = await CuentaCobro.sequelize!.transaction();
  try {
    const transaccion = esUuid(idTransaccion)
      ? await Transaccion.findByPk(idTransaccion, {
          include: [{ model: CuentaCobro }],
          transaction: t,
        })
      : null;

    if (!transaccion || !transaccion.CuentaCobro) {
      await t.rollback();
      return res.status(404).json(crearError('Transacción no encontrada'));
    }

    const cuenta = transaccion.CuentaCobro;

    // Mismo bloqueo que al registrar un pago.
    await CuentaCobro.findByPk(cuenta.id_cuenta_cobro, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // Tiene que ser el dueño del inmueble.
    let propio;
    try {
      propio = await contratoPropioDe(cuenta.id_contrato, sub);
    } catch (error) {
      await t.rollback();
      return responderServicioCaido(res, error, 'verificar el contrato');
    }

    if (!propio) {
      await t.rollback();
      return res.status(403).json(crearError('No autorizado'));
    }

    if (transaccion.estado === ESTADO_TRANSACCION_ANULADA) {
      await t.rollback();
      return res.status(409).json(crearError('La transacción ya está anulada'));
    }

    await transaccion.update(
      { estado: ESTADO_TRANSACCION_ANULADA },
      { transaction: t, usuarioAuditor: sub },
    );

    // El saldo se deriva de nuevo, ya sin esta transacción.
    const nuevoSaldo = await saldoDe(cuenta, { transaction: t });

    await cuenta.update(
      {
        fecha_pago: fechaPagoSegunSaldo(nuevoSaldo, cuenta.fecha_pago),
        estado: estadoSegunSaldo(cuenta.valor, nuevoSaldo, cuenta.estado),
      },
      { transaction: t, usuarioAuditor: sub },
    );

    await t.commit();

    return res.json({
      mensaje: 'Transacción anulada',
      transaccion,
      cuenta_cobro: { ...cuenta.toJSON(), saldo_pendiente: nuevoSaldo },
    });
  } catch (error) {
    await t.rollback();
    return res
      .status(500)
      .json({ mensaje: 'Error al anular la transacción', error: (error as Error).message });
  }
};

/**
 * `POST /api/pagos/verificar-mora` — marca EN_MORA las cuentas de los contratos
 * del propietario con la misma regla que el motor (`DIAS_PARA_MORA`,
 * `ESTADOS_QUE_ENTRAN_EN_MORA`).
 */
export const verificarMora = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const sub = subDe(req);
    const hoy = hoyEnZonaNegocio();

    // Sólo los contratos donde es dueño del inmueble.
    const mios = (await contratosDePropietario(sub)).map((contrato) => contrato.id_contrato);

    const candidatas = await CuentaCobro.findAll({
      where: {
        estado: { [Op.in]: [...ESTADOS_QUE_ENTRAN_EN_MORA] },
        inicio: { [Op.lt]: hoy },
        id_contrato: { [Op.in]: mios },
      },
    });

    // Los días de gracia se cuentan con `diasEntre`, en memoria.
    const vencidas = candidatas.filter(
      (cuenta) => diasEntre(cuenta.inicio, hoy) >= DIAS_PARA_MORA,
    );

    for (const cuenta of vencidas) {
      await cuenta.update({ estado: ESTADO_CUENTA_EN_MORA }, { usuarioAuditor: sub });
    }

    return res.json({ mensaje: 'Mora verificada', pagos_actualizados: vencidas.length });
  } catch (error) {
    return responderServicioCaido(res, error, 'verificar mora');
  }
};

// ── PDF ─────────────────────────────────────────────────────────────────────

/** Formateador de moneda. */
const fmt = (valor: unknown): string =>
  `$ ${parseFloat(String(valor ?? 0)).toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;

/**
 * Formateador de periodo (Ej: Junio 2026). En UTC: con la zona local, el día 1
 * caería en el mes anterior.
 */
const fmtPeriodo = (fecha: string): string =>
  new Date(fecha)
    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .replace(/^\w/, (c) => c.toUpperCase());

/** Datos comunes de la cabecera de los comprobantes. */
const datosEmpresa = {
  empresa_nombre: 'ARRIENDOS 360 S.A.S',
  empresa_nit: '900.123.456-7',
  empresa_telefono: '+57 (601) 321 0000',
  empresa_email: 'soporte@arriendos360.com',
  empresa_ciudad: 'Bogotá D.C.',
};

/** Bloque del arrendatario; «No disponible» si falta. */
const datosArrendatario = (arrendatario: Record<string, unknown> | null) => ({
  nombre_arrendatario: arrendatario
    ? `${String(arrendatario['nombres'])} ${String(arrendatario['apellidos'])}`
    : 'No disponible',
  cedula_arrendatario: arrendatario ? String(arrendatario['documento']) : 'No disponible',
  telefono_arrendatario: (arrendatario?.['telefono'] as string) || 'No registrado',
  email_arrendatario: (arrendatario?.['email'] as string) || 'No registrado',
});

/** Bloque del inmueble; «No disponible» si falta. */
const datosInmueble = (inmueble: Record<string, unknown> | null | undefined) => ({
  direccion_inmueble: inmueble ? String(inmueble['direccion']) : 'No disponible',
  barrio_ciudad: inmueble
    ? `${String(inmueble['barrio'])}, ${String(inmueble['municipio'])}`
    : 'No disponible',
  tipo_inmueble: inmueble ? String(inmueble['tipo']) : 'No disponible',
});

/** Genera el comprobante en PDF y lo envía como respuesta. */
const responderPdf = (res: Response, nombreArchivo: string, data: Record<string, unknown>): void => {
  const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
  doc.pipe(res);
  generarPDFComprobante(doc, data as Record<string, string | number | undefined>);
  doc.end();
};

/** El inmueble y el arrendatario de un contrato, para un PDF; `null` lo que falte. */
const partesParaPdf = async (
  idContrato: string,
): Promise<{
  inmueble: Record<string, unknown> | null;
  arrendatario: Record<string, unknown> | null;
}> => {
  const delContrato = await contratoPorId(idContrato, { conInmueble: true });
  const contrato = await adjuntarInquilino(delContrato);

  return {
    inmueble: (contrato?.['Inmueble'] as Record<string, unknown> | null) ?? null,
    arrendatario: (contrato?.['Inquilino'] as Record<string, unknown> | null) ?? null,
  };
};

/**
 * Comprobante de una transacción. El saldo sale de `saldo_restante_momento`, la
 * foto tomada al registrarla, no se recalcula.
 */
export const generarComprobante = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const idTransaccion = req.params['id_transaccion'] as string;
    const sub = subDe(req);

    const transaccion = esUuid(idTransaccion)
      ? await Transaccion.findByPk(idTransaccion, { include: [{ model: CuentaCobro }] })
      : null;

    if (!transaccion) {
      return res.status(404).json(crearError('No encontrado'));
    }

    const misContratos = await idsDondeEsParte(sub);

    if (!transaccion.CuentaCobro || !puedeVerCuenta(transaccion.CuentaCobro, misContratos)) {
      return res.status(403).json(crearError('No autorizado'));
    }

    const cuenta = transaccion.CuentaCobro;
    const { inmueble, arrendatario } = await partesParaPdf(cuenta.id_contrato);

    const esTotal = parseFloat(String(transaccion.saldo_restante_momento)) === 0;
    const periodo = fmtPeriodo(cuenta.inicio);

    const estadoImpreso =
      transaccion.estado === ESTADO_TRANSACCION_ANULADA
        ? 'ANULADA'
        : esTotal
          ? 'PAGADO'
          : 'ABONO PARCIAL';

    responderPdf(res, `Comprobante_${idTransaccion}.pdf`, {
      ...datosEmpresa,
      ...datosArrendatario(arrendatario),
      ...datosInmueble(inmueble),
      numero_comprobante: `TRX-${transaccion.id_transaccion}`,
      fecha_expedicion: new Date(transaccion.fecha_pago).toLocaleDateString('es-CO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      estado_pago: estadoImpreso,
      periodo,
      concepto: esTotal
        ? `Pago de arriendo periodo ${periodo}`
        : `Abono arriendo periodo ${periodo}`,
      canon_mensual: fmt(cuenta.valor),
      valor_pagado: fmt(transaccion.monto),
      saldo_anterior: fmt(
        parseFloat(String(transaccion.saldo_restante_momento)) +
          parseFloat(String(transaccion.monto)),
      ),
      saldo_pendiente: fmt(transaccion.saldo_restante_momento),
      forma_pago: transaccion.medio_pago || 'Transferencia Bancaria',
      banco: 'Red Bancaria Nacional',
      referencia_pago: transaccion.observaciones || `Abono No. ${transaccion.id_transaccion}`,
    });

    return undefined;
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ mensaje: 'Error al generar PDF', error: (error as Error).message });
  }
};

/** Como se etiqueta cada estado en el recibo. */
const ETIQUETA_ESTADO: Record<string, string> = {
  [ESTADO_CUENTA_PENDIENTE]: 'PENDIENTE',
  [ESTADO_CUENTA_PAGADA]: 'PAGADO',
  [ESTADO_CUENTA_EN_MORA]: 'EN MORA',
  [ESTADO_CUENTA_PARCIAL]: 'PAGO PARCIAL',
};

/**
 * Recibo mensual de una cuenta de cobro. `forma_pago` es el medio de la última
 * transacción confirmada, o «Múltiple» si no hay ninguna.
 */
export const generarRecibo = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const id = req.params['id'] as string;
    const sub = subDe(req);

    const cuenta = esUuid(id) ? await CuentaCobro.findByPk(id) : null;

    if (!cuenta) {
      return res.status(404).json(crearError('No encontrado'));
    }

    const misContratos = await idsDondeEsParte(sub);

    if (!puedeVerCuenta(cuenta, misContratos)) {
      return res.status(403).json(crearError('No autorizado'));
    }

    const saldo = await saldoDe(cuenta);

    const ultima = await Transaccion.findOne({
      where: {
        id_cuenta_cobro: cuenta.id_cuenta_cobro,
        estado: ESTADO_TRANSACCION_CONFIRMADA,
      },
      order: [['fecha_pago', 'DESC']],
    });

    const { inmueble, arrendatario } = await partesParaPdf(cuenta.id_contrato);

    const esTotal = saldo === 0;
    const periodo = fmtPeriodo(cuenta.inicio);

    responderPdf(res, `Recibo_Mensual_${id}.pdf`, {
      ...datosEmpresa,
      ...datosArrendatario(arrendatario),
      ...datosInmueble(inmueble),
      numero_comprobante: `REC-${cuenta.id_cuenta_cobro}`,
      fecha_expedicion: new Date().toLocaleDateString('es-CO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      estado_pago: ETIQUETA_ESTADO[cuenta.estado],
      periodo,
      concepto: esTotal
        ? `Pago de arriendo periodo ${periodo}`
        : `Abono arriendo periodo ${periodo}`,
      canon_mensual: fmt(cuenta.valor),
      valor_pagado: fmt(parseFloat(String(cuenta.valor)) - saldo),
      saldo_anterior: fmt(cuenta.valor),
      saldo_pendiente: fmt(saldo),
      forma_pago: ultima?.medio_pago || 'Múltiple',
      banco: 'N/A',
      referencia_pago: `Recibo mensual No. ${cuenta.id_cuenta_cobro}`,
    });

    return undefined;
  } catch (error) {
    return res
      .status(500)
      .json({ mensaje: 'Error al generar PDF', error: (error as Error).message });
  }
};
