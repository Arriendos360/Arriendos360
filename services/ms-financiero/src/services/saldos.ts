/**
 * El saldo de una cuenta de cobro, derivado.
 *
 * Hasta el paso 6c esto era una columna, `pagos.saldo_pendiente`, que el
 * controlador restaba a mano en cada abono. El modelo canonico no la tiene, y
 * hace bien: el saldo es `valor` menos lo cobrado, y guardar el resultado de una
 * resta obliga a que todo camino de escritura se acuerde de rehacerla. El dia
 * que uno se olvide —o que alguien corrija una fila a mano— la columna y las
 * transacciones dicen cosas distintas y nada lo delata.
 *
 * Aqui se calcula, y en un solo sitio. Todo lo demas lo consume:
 *
 *   - los controladores, que lo adjuntan a la respuesta como `saldo_pendiente`
 *     para que el frontend siga recibiendo el mismo campo;
 *   - el registro de una transaccion, que lo necesita para no aceptar un
 *     sobrepago;
 *   - la anulacion, que no tiene que devolver nada: el saldo se corrige solo
 *     porque la suma deja de contar la transaccion anulada;
 *   - el `/interno` del dashboard, que expone HECHOS al gateway.
 *
 * ── SOLO CUENTAN LAS CONFIRMADAS ────────────────────────────────────────────
 *
 * Es toda la definicion, y es lo que hace que anular funcione sin tocar mas
 * datos que un `estado`.
 *
 * ── UN VIAJE POR LISTA, NO UNO POR CUENTA ───────────────────────────────────
 *
 * `conSaldos()` resuelve una lista entera con UNA consulta agrupada. La misma
 * disciplina que `clientes/` aplica a las llamadas de red: la pantalla de Pagos
 * pide todas las cuentas del propietario de golpe, y una consulta por fila
 * convertiria la lista en el sitio mas lento de la aplicacion.
 */

import { Op, col, fn } from 'sequelize';

import { Transaccion } from '../models/Transaccion';
import type { CuentaCobro } from '../models/CuentaCobro';
import {
  ESTADO_CUENTA_EN_MORA,
  ESTADO_CUENTA_PAGADA,
  ESTADO_CUENTA_PARCIAL,
  ESTADO_CUENTA_PENDIENTE,
  ESTADO_TRANSACCION_CONFIRMADA,
} from '../models/constantes';

/** Lo minimo que necesita esta funcion de una cuenta: su id y su importe. */
export interface CuentaConValor {
  id_cuenta_cobro: string;
  valor: number | string;
  [clave: string]: unknown;
}

/** Opciones de lectura: hoy solo la transaccion en curso. */
export interface OpcionesLectura {
  transaction?: unknown;
}

/**
 * Redondeo a dos decimales, que es la precision de la columna.
 *
 * `NUMERIC(12,2)` llega a JavaScript como cadena y se opera como `Number`, que
 * es binario: restar 1000 menos 400 menos 600 puede dar `1.1368683772161603e-13`
 * en vez de `0`, y entonces `saldo <= 0` sigue siendo cierto pero la respuesta
 * lleva ese numero en `saldo_pendiente` y el frontend lo pinta. La suma la hace
 * PostgreSQL en `NUMERIC` y es exacta; lo que se redondea es la resta final.
 */
const redondear = (valor: number): number => Math.round(valor * 100) / 100;

/** Convierte una instancia de Sequelize en objeto plano, o la deja pasar. */
const aPlano = <T>(entidad: T): Record<string, unknown> => {
  const posible = entidad as unknown as { toJSON?: () => Record<string, unknown> };
  return typeof posible?.toJSON === 'function'
    ? posible.toJSON()
    : (entidad as unknown as Record<string, unknown>);
};

/**
 * Lo cobrado y confirmado contra cada una de esas cuentas.
 *
 * @param ids identificadores de cuenta de cobro
 * @param opciones `transaction`, para leer dentro de una transaccion
 * @returns id -> total confirmado (ausente si no hay ninguna)
 */
export const cobradoPorCuenta = async (
  ids: Array<string | null | undefined>,
  opciones: OpcionesLectura = {},
): Promise<Map<string, number>> => {
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];

  if (unicos.length === 0) {
    return new Map();
  }

  const filas = (await Transaccion.findAll({
    attributes: ['id_cuenta_cobro', [fn('SUM', col('monto')), 'cobrado']],
    where: { id_cuenta_cobro: { [Op.in]: unicos }, estado: ESTADO_TRANSACCION_CONFIRMADA },
    group: ['id_cuenta_cobro'],
    raw: true,
    ...(opciones as object),
  })) as unknown as Array<{ id_cuenta_cobro: string; cobrado: string }>;

  return new Map(filas.map((fila) => [fila.id_cuenta_cobro, parseFloat(fila.cobrado)]));
};

/**
 * El saldo de UNA cuenta, leido dentro de una transaccion.
 *
 * Lo usan el registro y la anulacion, que necesitan el valor con el bloqueo de
 * la transaccion en curso y no pueden fiarse de una lectura anterior.
 */
export const saldoDe = async (
  cuenta: CuentaConValor | CuentaCobro,
  opciones: OpcionesLectura = {},
): Promise<number> => {
  const cobrado = await cobradoPorCuenta([cuenta.id_cuenta_cobro], opciones);
  return redondear(
    parseFloat(String(cuenta.valor)) - (cobrado.get(cuenta.id_cuenta_cobro) ?? 0),
  );
};

/**
 * Adjunta `saldo_pendiente` a una lista de cuentas de cobro.
 *
 * El nombre del campo es el de la columna que desaparecio, a proposito: el
 * frontend y los PDF lo leen con ese nombre y no tienen por que enterarse de que
 * ahora se calcula.
 */
export const conSaldos = async (
  cuentas: Array<CuentaConValor | CuentaCobro | Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> => {
  const lista = (cuentas ?? []).map(aPlano);
  const cobrado = await cobradoPorCuenta(
    lista.map((cuenta) => cuenta['id_cuenta_cobro'] as string),
  );

  return lista.map((cuenta) => ({
    ...cuenta,
    saldo_pendiente: redondear(
      parseFloat(String(cuenta['valor'])) -
        (cobrado.get(cuenta['id_cuenta_cobro'] as string) ?? 0),
    ),
  }));
};

/** Adjunta `saldo_pendiente` a una sola cuenta. */
export const conSaldo = async (
  cuenta: CuentaConValor | CuentaCobro | null,
): Promise<Record<string, unknown> | null> => {
  if (!cuenta) {
    return null;
  }

  const [conElSaldo] = await conSaldos([cuenta]);
  return conElSaldo ?? null;
};

/**
 * Adjunta `saldo_pendiente` a la cuenta de cobro ANIDADA de una lista.
 *
 * Existe porque una transaccion no tiene saldo propio: cuelga de una cuenta que
 * si lo tiene, y el historial lee esa ruta.
 *
 * @param elementos transacciones
 * @param camino como llegar a la cuenta desde cada elemento
 */
export const conSaldoAnidado = async (
  elementos: Array<Record<string, unknown> | Transaccion>,
  camino: (elemento: Record<string, unknown>) => Record<string, unknown> | null | undefined,
): Promise<Array<Record<string, unknown>>> => {
  const lista = (elementos ?? []).map(aPlano);
  const cuentas = lista.map((elemento) => camino(elemento)).filter(Boolean) as Array<
    Record<string, unknown>
  >;
  const cobrado = await cobradoPorCuenta(
    cuentas.map((cuenta) => cuenta['id_cuenta_cobro'] as string),
  );

  for (const elemento of lista) {
    const cuenta = camino(elemento);
    if (cuenta) {
      cuenta['saldo_pendiente'] = redondear(
        parseFloat(String(cuenta['valor'])) -
          (cobrado.get(cuenta['id_cuenta_cobro'] as string) ?? 0),
      );
    }
  }

  return lista;
};

/**
 * El estado que le corresponde a una cuenta con este saldo.
 *
 * ES LA MISMA REGLA QUE APLICABA EL CONTROLADOR con los enteros, escrita entera
 * en un sitio en vez de en un ternario anidado dentro de `registrarPago`:
 *
 *   saldo 0            -> PAGADA
 *   venia de EN_MORA   -> sigue EN_MORA, se haya abonado o no
 *   saldo == valor     -> PENDIENTE  (no se ha cobrado nada)
 *   0 < saldo < valor  -> PARCIAL
 *
 * `EN_MORA` gana sobre `PARCIAL` porque no dicen lo mismo: uno habla de cuanto
 * se ha pagado y el otro de si llego a tiempo. Abonar la mitad de una cuenta
 * vencida no la pone al dia.
 *
 * Que sea una FUNCION DEL SALDO y no una secuencia de transiciones es lo que
 * hace que anular funcione: se recalcula con el saldo nuevo y la cuenta vuelve
 * exactamente al estado que tenia antes de la transaccion que se anulo, sin
 * guardar en ninguna parte cual era.
 */
export const estadoSegunSaldo = (
  valor: number | string,
  saldo: number,
  estadoActual: string,
): string => {
  if (saldo <= 0) {
    return ESTADO_CUENTA_PAGADA;
  }

  if (estadoActual === ESTADO_CUENTA_EN_MORA) {
    return ESTADO_CUENTA_EN_MORA;
  }

  return saldo >= parseFloat(String(valor)) ? ESTADO_CUENTA_PENDIENTE : ESTADO_CUENTA_PARCIAL;
};

/**
 * `fecha_pago` de la cuenta: cuando quedo cubierta, o `null` si no lo esta.
 *
 * Se decide con el mismo dato que el estado, y por eso vive al lado. Antes la
 * escribia cualquier abono sin mirar el saldo, asi que una cuenta pagada a
 * medias quedaba con fecha de pago puesta; con la anulacion en pie eso importa,
 * porque una cuenta que vuelve a PENDIENTE no puede seguir diciendo cuando se
 * pago.
 */
export const fechaPagoSegunSaldo = (saldo: number, momento: Date | null): Date | null =>
  saldo <= 0 ? momento : null;
