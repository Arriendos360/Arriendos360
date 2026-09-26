/**
 * Emisión de cuentas de cobro: único sitio que las crea. Lo usan el consumidor de
 * `ContratoFormalizado`, el motor y el alta manual, y en los tres anota
 * `CuentaCobroGenerada` en la misma transacción.
 */

import crypto from 'crypto';
import type { Transaction } from 'sequelize';

import { sequelize } from '../config/database';
import { CuentaCobro } from '../models/CuentaCobro';
import { ESTADO_CUENTA_PENDIENTE } from '../models/constantes';
import { registrarCuentaCobroGenerada } from '../eventos/salida';

/** Lo que hace falta para emitir una cuenta de cobro. */
export interface DatosEmision {
  id_contrato: string;
  /**
   * A quién se le factura, para el evento; no se guarda en la cuenta. Sin él, la
   * cuenta se crea sin aviso.
   */
  id_inquilino?: string | undefined;
  valor: number | string;
  inicio: string;
  fin: string;
  detalle: string;
  /** Quien queda en las columnas de auditoria. Ausente = USUARIO_SISTEMA. */
  auditor?: string | undefined;
}

/** Una emision hecha: la fila y si se anuncio. */
export interface Emision {
  cuenta: CuentaCobro;
  /** `false` si no habia a quien avisar. Ver `id_inquilino`. */
  anunciada: boolean;
}

/**
 * Crea la cuenta de cobro y anota su evento, en la misma transacción.
 *
 * @param transaccion la del llamante, si ya tiene una abierta (el consumidor del
 *   bus siempre la pasa); si no, se abre una.
 */
export const emitirCuentaCobro = async (
  datos: DatosEmision,
  transaccion?: unknown,
): Promise<Emision> => {
  const dentroDe = async (tx: Transaction): Promise<Emision> => {
    // El UUID se genera antes del INSERT porque lo lleva el evento.
    const idCuentaCobro = crypto.randomUUID();

    const cuenta = await CuentaCobro.create(
      {
        id_cuenta_cobro: idCuentaCobro,
        id_contrato: datos.id_contrato,
        detalle: datos.detalle,
        valor: datos.valor,
        inicio: datos.inicio,
        fin: datos.fin,
        estado: ESTADO_CUENTA_PENDIENTE,
      },
      // Sin `auditor`, la auditoría queda a nombre de USUARIO_SISTEMA.
      { transaction: tx, ...(datos.auditor ? { usuarioAuditor: datos.auditor } : {}) } as never,
    );

    if (!datos.id_inquilino) {
      console.warn(
        `⚠️  ms-financiero: cuenta de cobro ${idCuentaCobro} creada SIN aviso — no se ` +
          'conoce el inquilino del contrato ' +
          `${datos.id_contrato}. Probablemente un ContratoFormalizado versión 1.`,
      );
      return { cuenta, anunciada: false };
    }

    await registrarCuentaCobroGenerada(
      {
        id_cuenta_cobro: idCuentaCobro,
        id_contrato: datos.id_contrato,
        id_inquilino: datos.id_inquilino,
        // `valor` puede llegar como texto (DECIMAL); el evento lleva un número.
        valor: Number(datos.valor),
        inicio: datos.inicio,
        fin: datos.fin,
      },
      tx,
    );

    return { cuenta, anunciada: true };
  };

  return transaccion
    ? dentroDe(transaccion as Transaction)
    : sequelize.transaction((tx) => dentroDe(tx));
};
