/**
 * Saldo de una cuenta de cobro: `valor` menos la suma de sus transacciones
 * `CONFIRMADA`. No es una columna. Una lista se resuelve con una sola consulta
 * agrupada.
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

/** Redondeo a dos decimales, para no arrastrar errores de coma flotante. */
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

/** El saldo de una cuenta, opcionalmente dentro de una transacción. */
export const saldoDe = async (
  cuenta: CuentaConValor | CuentaCobro,
  opciones: OpcionesLectura = {},
): Promise<number> => {
  const cobrado = await cobradoPorCuenta([cuenta.id_cuenta_cobro], opciones);
  return redondear(
    parseFloat(String(cuenta.valor)) - (cobrado.get(cuenta.id_cuenta_cobro) ?? 0),
  );
};

/** Adjunta `saldo_pendiente` a una lista de cuentas de cobro. */
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
 * Adjunta `saldo_pendiente` a la cuenta de cobro anidada de cada elemento.
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
 * El estado que le corresponde a una cuenta con este saldo:
 *
 *   saldo 0            -> PAGADA
 *   venia de EN_MORA   -> sigue EN_MORA, se haya abonado o no
 *   saldo == valor     -> PENDIENTE  (no se ha cobrado nada)
 *   0 < saldo < valor  -> PARCIAL
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

/** `fecha_pago` de la cuenta: cuándo quedó cubierta, o `null` si no lo está. */
export const fechaPagoSegunSaldo = (saldo: number, momento: Date | null): Date | null =>
  saldo <= 0 ? momento : null;
