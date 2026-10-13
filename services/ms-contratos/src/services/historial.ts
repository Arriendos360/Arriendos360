/**
 * Historial de cambios de un contrato: una fila por campo editable o estado que cambia, escrita en
 * la misma transacción que el cambio. Si el cambio falla, no queda historia.
 */

import type { Transaction } from 'sequelize';
import { soloFecha } from 'arriendos360-shared';
import { CAMPOS_CONTRATO_EDITABLES } from 'arriendos360-contracts';

import type { Contrato } from '../models/Contrato';
import { HistorialContrato } from '../models/HistorialContrato';

const CAMPOS_CON_HISTORIA: readonly string[] = [...CAMPOS_CONTRATO_EDITABLES, 'estado'];

/** Lo que una cancelación guarda además del cambio de estado. */
export interface ExtraCancelacion {
  motivo: string;
  indemnizacion: number;
  indemnizacion_a_cargo_de: string | null;
}

/** El valor como se guarda y se muestra: fechas `YYYY-MM-DD`, el canon con sus centavos, vacío es `null`. */
const comoTexto = (campo: string, valor: unknown): string | null => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (campo === 'fin') return soloFecha(valor);
  if (campo === 'canon') return Number(valor).toFixed(2);
  return String(valor);
};

/**
 * Anota los campos de `cambios` cuyo valor difiere del actual del contrato. Lee el contrato antes
 * del cambio: llámalo antes de `contrato.update`, dentro de la misma transacción.
 */
export const registrarCambios = async (
  contrato: Contrato,
  cambios: Record<string, unknown>,
  sub: string,
  transaccion: Transaction,
  extra?: ExtraCancelacion,
): Promise<HistorialContrato[]> => {
  const filas = CAMPOS_CON_HISTORIA.filter((campo) => campo in cambios)
    .map((campo) => ({
      campo,
      valor_anterior: comoTexto(campo, contrato.getDataValue(campo)),
      valor_nuevo: comoTexto(campo, cambios[campo]),
    }))
    .filter((fila) => fila.valor_anterior !== fila.valor_nuevo)
    .map((fila) => ({ ...fila, ...extra, id_contrato: contrato.id_contrato, cambiado_por: sub }));

  return filas.length > 0 ? HistorialContrato.bulkCreate(filas, { transaction: transaccion }) : [];
};
