/**
 * Cuentas de cobro y transacciones.
 *
 * ── QUE CAMBIA EN EL PASO 6e, Y QUE NO ─────────────────────────────────────
 *
 * NO cambia ni un endpoint, ni un cuerpo, ni un codigo de estado. El prefijo
 * sigue siendo `/api/pagos` y lo que la SPA recibe es byte por byte lo que
 * recibia cuando esto vivia en el gateway. Lo que cambia es donde corre y de
 * donde saca lo que no es suyo.
 *
 * SI cambia quien pregunta por los contratos. Antes el gateway le preguntaba a
 * ms-contratos por HTTP y consultaba sus propias tablas; ahora este servicio
 * hace las dos cosas, con las tablas ya suyas. La costura del gateway reenvia
 * `/api/pagos` entero y no abre la respuesta.
 *
 * ── LA DISYUNCION DE VISIBILIDAD NO CAMBIA ─────────────────────────────────
 *
 * Se ve una cuenta si eres el dueño del inmueble O el inquilino del contrato. Lo
 * que cambia desde el paso 6d es quien la evalua: la resuelve ms-contratos
 * entera y de una vez, porque tiene la mitad barata (`id_inquilino` es columna
 * suya) y sabe pedir la cara (`id_propietario` esta en ms-inmuebles). Aqui llega
 * ya resuelta, como una lista de identificadores que entra en un `IN` contra la
 * base local. Ver `docs/adr/0017`.
 *
 * ── EL ORDEN DE LAS DOS COMPROBACIONES IMPORTA ─────────────────────────────
 *
 * En los endpoints que escriben, la pertenencia se comprueba ANTES de tocar
 * nada, y el fallo de red se propaga: nunca se degrada a 403. Decirle a alguien
 * «no tienes permisos» cuando en realidad no se ha podido comprobar es la peor
 * de las respuestas posibles.
 *
 * ── ABAC, QUE NO ES LO MISMO QUE RBAC ──────────────────────────────────────
 *
 * El gateway ya aplico su matriz —«¿puede un PROPIETARIO llamar esta ruta?»— y
 * el middleware de este servicio la revalida. Nada de eso dice que ESTE recurso
 * sea suyo, y eso es lo que comprueba cada handler de aqui (regla dura 8).
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

/**
 * 502 con el formato de error del proyecto.
 *
 * El mensaje nombra a Contratos porque es el servicio con el que este
 * controlador habla para autorizar, y el que responde cuando la pertenencia no
 * se puede comprobar.
 */
const responderServicioCaido = (res: Response, error: unknown, accion: string): Response => {
  console.error(`Error al ${accion}:`, (error as Error).message);
  return res.status(502).json(crearError('No se pudo contactar el servicio de contratos'));
};

/**
 * ¿Este error viene de no poder hablar con ms-contratos?
 *
 * Existe porque `crearCuentaCobro` tiene un solo `try` que cubre la comprobacion
 * de pertenencia y la escritura, y las dos fallan distinto: una es la red y la
 * otra la base. Distinguirlas es lo que separa un 502 honesto de un 500 con el
 * mensaje interno dentro.
 */
const esFalloDeContratos = (error: unknown): boolean => {
  const mensaje = (error as Error).message;
  return typeof mensaje === 'string' && mensaje.includes('ms-contratos');
};

/** Lo que sustituye al `Op.or` sobre columnas del `include`. */
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
    // UNA peticion: la disyuncion de pertenencia ya viene resuelta.
    const misContratos = await idsDondeEsParte(subDe(req));

    const cuentas = await CuentaCobro.findAll({ where: deMisContratos(misContratos) });

    // Dos composiciones: el contrato con su inmueble sale de ms-contratos en un
    // lote, y el saldo de una consulta agrupada local.
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

    // La disyuncion entera en una llamada: ms-contratos ya sabe si este usuario
    // es el dueño del inmueble o el inquilino.
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

    // El `include` NO cruza frontera: `cuentas_cobro` y `transacciones` son las
    // dos tablas de este servicio. Lo que si se compone es el contrato y su
    // inmueble, un nivel mas abajo.
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

    // Las anuladas SE DEVUELVEN. Dejarlas fuera seria esconder que un movimiento
    // se registro y se corrigio, que es justo lo que el estado existe para hacer
    // visible.
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
 * Alta manual de una cuenta de cobro — `POST /api/pagos/cuentas-cobro`.
 *
 * El camino normal es que la primera cuenta nazca del evento y las siguientes
 * del motor. Esto existe para la demostracion y para corregir a mano, y por eso
 * el periodo se puede omitir: se deriva del ciclo de facturacion del contrato
 * con la MISMA funcion que usa el motor, y no con una segunda cuenta que podria
 * separarse.
 *
 * ── DESDE EL PASO 7 ESTO TAMBIEN AVISA AL INQUILINO, Y ES NUEVO ────────────
 *
 * Antes creaba la cuenta en silencio: el correo de «recibo generado» solo lo mandaba
 * el motor. Ahora los tres caminos que crean una cuenta pasan por
 * `emitirCuentaCobro`, que anota `CuentaCobroGenerada`, asi que este tambien avisa.
 *
 * Es deliberado. El hecho es el mismo —se le emitio una factura a alguien— y quien la
 * recibe tiene el mismo derecho a enterarse la haya generado un barrido o una
 * persona. La alternativa era un `avisar: false` para este camino, es decir,
 * exactamente los tres-sitios-que-hacen-cosas-distintas que `services/cuentas.ts`
 * existe para cerrar. Anotado como comportamiento nuevo en `docs/adr/0019`.
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

    // Cobrar es exclusivo del dueño del inmueble, asi que aqui no basta con ser
    // parte: hay que ser el propietario. Se le pregunta a ms-contratos, que
    // resuelve las dos mitades —el contrato y de quien es su inmueble— en un
    // solo salto.
    const contrato =
      id_contrato && esUuid(id_contrato) ? await contratoPropioDe(id_contrato, sub) : null;

    if (!contrato) {
      return res.status(403).json(crearError('No tienes permisos sobre este contrato'));
    }

    const diaCorte = diaDeCorte(contrato.fecha_inicio_corte);
    const inicioPedido = soloFecha(req.body.inicio);

    // Si viene `inicio`, el `fin` se calcula con el dia pactado del contrato y
    // no con «un mes menos un dia»: los periodos tienen que seguir teselando el
    // calendario aunque la cuenta se cree a mano.
    const periodo =
      inicioPedido && diaCorte !== null
        ? { ...periodoQueEmpiezaEn(inicioPedido, diaCorte), inicio: inicioPedido }
        : periodoAFacturar(diaCorte ?? 1, hoyEnZonaNegocio());

    const fin = soloFecha(req.body.fin) ?? periodo.fin;

    // El inquilino sale del contrato que ya se pidio para comprobar la pertenencia:
    // no cuesta un viaje mas. Lo necesita el evento, no la fila.
    const { cuenta } = await emitirCuentaCobro({
      id_contrato: id_contrato as string,
      id_inquilino: contrato.id_inquilino,
      valor: valor as number,
      inicio: periodo.inicio,
      fin,
      detalle: detalle ?? `Canon de arrendamiento del ${periodo.inicio} al ${fin}`,
      // Aqui SI hay una persona detras, al contrario que en el motor y en el
      // consumidor del evento: la cuenta queda a su nombre en la auditoria.
      auditor: sub,
    });

    return res.status(201).json({
      mensaje: 'Cuenta de cobro registrada exitosamente',
      cuenta_cobro: await conSaldo(cuenta),
    });
  } catch (error) {
    // Un fallo de ms-contratos no es un 500 nuestro: no se pudo comprobar la
    // pertenencia, y eso es 502.
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
 * Registrar un pago — `POST /api/pagos`. RF-17.
 *
 * El cuerpo es el del Capitulo 2. `tipo` se admite ausente y cae en `INGRESO`,
 * que hoy es su unico valor: exigir que el cliente mande una constante no añade
 * seguridad, pero mandar un valor que no existe si es un error y se rechaza.
 *
 * El saldo se LEE dentro de la transaccion y con la fila de la cuenta bloqueada.
 * Las dos cosas hacen falta: leer dentro evita arrastrar un saldo viejo, y
 * bloquear evita que dos registros simultaneos vean cada uno el saldo entero y
 * acepten los dos.
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

  // La pertenencia se resuelve ANTES de abrir la transaccion: es una llamada de
  // red, y tenerla dentro alargaria el bloqueo de la fila por el tiempo que
  // tarde otro servicio en contestar.
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

    // `FOR UPDATE` sobre la fila de la cuenta, en una consulta aparte y sin
    // `include`: PostgreSQL rechaza el bloqueo sobre el lado anulable de un LEFT
    // JOIN, y pedirlo sobre la consulta con el contrato bloquearia ademas filas
    // de otro agregado sin ninguna necesidad.
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
        // La foto historica, la unica cifra de saldo que se guarda.
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
 * Anular una transaccion — `POST /api/pagos/transacciones/:id/anular`.
 *
 * ANULAR NO BORRA. Cambia el estado a `ANULADA` y recalcula el de la cuenta; el
 * saldo se corrige solo porque la suma que lo deriva ignora las anuladas. La
 * fila y su comprobante siguen existiendo, que es lo que separa una correccion
 * de una falsificacion. Ver `docs/adr/0016`.
 *
 * El ABAC exige ser DUEÑO del inmueble, no solo parte del contrato — el mismo
 * criterio que el alta de una cuenta de cobro y por el mismo motivo: esto
 * reescribe la contabilidad del arriendo, y quien la lleva es el propietario
 * (`docs/adr/0006`).
 *
 * Una transaccion ya anulada responde 409 y no 403: el recurso es suyo y su rol
 * es el correcto, lo que falla es que no esta en condiciones.
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

    // Mismo bloqueo que al registrar, y por lo mismo: anular recalcula el saldo,
    // y un registro simultaneo sobre la misma cuenta lo dejaria mal.
    await CuentaCobro.findByPk(cuenta.id_cuenta_cobro, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // Ser DUEÑO, no solo parte. Un salto a ms-contratos, que comprueba de paso
    // de quien es el inmueble: este servicio no necesita saber que un contrato
    // tiene uno.
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

    // Se relee DESPUES de anular: el saldo nuevo sale de la misma suma de
    // siempre, que ahora ya no cuenta esta transaccion. No hay ninguna resta que
    // deshacer ni ningun estado anterior que recordar.
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
 * `POST /api/pagos/verificar-mora`.
 *
 * ── ESTO YA NO SE APARTA DEL MOTOR, Y ERA UNA TRAMPA CONOCIDA ──────────────
 *
 * CLAUDE.md la tenia anotada: «un contrato de 16 lineas de mora no existe:
 * `verificar-mora` y el motor no aplican la misma regla». Este endpoint marcaba
 * EN_MORA toda cuenta PENDIENTE o PARCIAL cuyo corte ya hubiera pasado —un solo
 * dia bastaba— mientras que `procesarPagos()` espera al sexto. Quien lo
 * disparara desde Postman dejaba cuentas en mora que el motor no habria marcado,
 * y que ademas no volvian atras solas.
 *
 * Se unifica aqui, que es lo que el paso 6e tocaba hacer: la regla es «seis dias
 * desde el corte», la misma constante y el mismo `diasEntre()` que usa el motor.
 * Y los mismos estados, `ESTADOS_QUE_ENTRAN_EN_MORA`: `PENDIENTE` y `PARCIAL`. Una
 * cuenta con saldo y el corte vencido entra en mora aunque haya recibido abonos.
 *
 * Lo que NO se unifica es el alcance: el motor barre el sistema entero y esto
 * solo los contratos de quien llama. Es la diferencia entre un proceso y una
 * peticion, y esa si tiene que seguir.
 */
export const verificarMora = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const sub = subDe(req);
    const hoy = hoyEnZonaNegocio();

    // Solo sobre los PROPIOS, y aqui propio significa dueño del inmueble, no
    // parte: verificar la mora ESCRIBE, y escribir sobre la cuenta de otro seria
    // peor que verla. Un inquilino no puede marcarse a si mismo.
    const mios = (await contratosDePropietario(sub)).map((contrato) => contrato.id_contrato);

    const candidatas = await CuentaCobro.findAll({
      where: {
        estado: { [Op.in]: [...ESTADOS_QUE_ENTRAN_EN_MORA] },
        inicio: { [Op.lt]: hoy },
        id_contrato: { [Op.in]: mios },
      },
    });

    // El filtro de los seis dias se aplica en memoria y no en el `where` a
    // proposito: `diasEntre()` cuenta dias de CALENDARIO en la zona del negocio,
    // y trasladar eso a SQL significaria escribir la aritmetica de fechas otra
    // vez, en otro lenguaje, con otra zona por defecto. Son decenas de filas, no
    // millones, y el `where` de arriba ya descarto las que ni siquiera han
    // llegado a su corte.
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
 * Formateador de periodo (Ej: Junio 2026).
 *
 * `timeZone: 'UTC'` NO es un adorno. `inicio` es `DATEONLY` y llega como
 * `'2026-06-01'`, que `Date` interpreta como medianoche UTC; formatearlo en la
 * zona local imprimiria «mayo de 2026» en Bogota, es decir, el mes equivocado.
 * Es la misma zona que ya usa el `formatDate` del frontend.
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

/**
 * Bloque del arrendatario.
 *
 * Tolera que falte: si ms-identidad no respondio, el recibo sale con «No
 * disponible» en lugar de no salir. Un comprobante incompleto sirve para algo;
 * un 500 al pedir el recibo, no.
 */
const datosArrendatario = (arrendatario: Record<string, unknown> | null) => ({
  nombre_arrendatario: arrendatario
    ? `${String(arrendatario['nombres'])} ${String(arrendatario['apellidos'])}`
    : 'No disponible',
  cedula_arrendatario: arrendatario ? String(arrendatario['documento']) : 'No disponible',
  telefono_arrendatario: (arrendatario?.['telefono'] as string) || 'No registrado',
  email_arrendatario: (arrendatario?.['email'] as string) || 'No registrado',
});

/**
 * Bloque del inmueble.
 *
 * Tolera que falte, igual que el del arrendatario: si el inmueble no vino dentro
 * del contrato, el recibo sale con «No disponible» en lugar de no salir.
 */
const datosInmueble = (inmueble: Record<string, unknown> | null | undefined) => ({
  direccion_inmueble: inmueble ? String(inmueble['direccion']) : 'No disponible',
  barrio_ciudad: inmueble
    ? `${String(inmueble['barrio'])}, ${String(inmueble['municipio'])}`
    : 'No disponible',
  tipo_inmueble: inmueble ? String(inmueble['tipo']) : 'No disponible',
});

/** Envia un PDF ya construido con el mismo encabezado de siempre. */
const responderPdf = (res: Response, nombreArchivo: string, data: Record<string, unknown>): void => {
  const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
  doc.pipe(res);
  generarPDFComprobante(doc, data as Record<string, string | number | undefined>);
  doc.end();
};

/**
 * El contrato de una cuenta, con su inmueble y su arrendatario, para un PDF.
 *
 * Dos peticiones —ms-contratos con `incluir=inmueble`, y ms-identidad para el
 * inquilino— y las dos DEGRADAN: lo que no venga queda en `null` y el PDF
 * imprime «No disponible». Ver `services/composicion.ts`.
 */
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
 * Comprobante de una transaccion — RF-18.
 *
 * IMPRIME LO MISMO QUE ANTES DE LA EXTRACCION, y hay un dato que lo garantiza:
 * el saldo del comprobante NO se recalcula. Sale de `saldo_restante_momento`,
 * que es la foto que se tomo al registrar el movimiento. Un comprobante emitido
 * hace tres meses dice hoy exactamente lo que decia entonces, aunque despues se
 * hayan registrado o anulado otras transacciones sobre la misma cuenta.
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

/** Como se etiqueta cada estado en el recibo. Los cuatro textos son los de antes. */
const ETIQUETA_ESTADO: Record<string, string> = {
  [ESTADO_CUENTA_PENDIENTE]: 'PENDIENTE',
  [ESTADO_CUENTA_PAGADA]: 'PAGADO',
  [ESTADO_CUENTA_EN_MORA]: 'EN MORA',
  [ESTADO_CUENTA_PARCIAL]: 'PAGO PARCIAL',
};

/**
 * Recibo mensual de una cuenta de cobro (resumen del periodo).
 *
 * `forma_pago` sale del medio de la ULTIMA transaccion confirmada. Antes salia
 * de `pagos.tipo_transaccion`, una columna que el controlador iba pisando con el
 * medio del ultimo abono: es el mismo dato, leido de donde de verdad vive en vez
 * de una copia. Si no hay ninguna transaccion todavia, «Múltiple», como antes.
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
