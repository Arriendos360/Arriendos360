/**
 * MS-Financiero como consumidor: `ContratoFormalizado` crea la primera cuenta de
 * cobro y anota `CuentaCobroGenerada`, en la misma transacción que marca el
 * evento como procesado. `ContratoFinalizado` no tiene manejador: finalizar no
 * cancela lo que se debe.
 */

import {
  TIPO_CONTRATO_FORMALIZADO,
  type ContratoFormalizado,
  type Consumidor,
  type Manejador,
  comoConexion,
  crearConsumidor,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';
import { esUuid } from '../models/uuid';
import { emitirCuentaCobro } from '../services/cuentas';
import { detalleDelPeriodo, primerPeriodoDe } from '../services/motor';

/** Bitácora de eventos procesados de este consumidor. */
export const TABLA_PROCESADOS = `${ESQUEMA}.eventos_procesados`;

/**
 * Valida la carga de `ContratoFormalizado`. Lanza si falta `id_contrato`, `canon`
 * o `fecha_inicio_corte`; sin `id_inquilino` (sobre v1) la cuenta se crea sin aviso.
 */
const cargaDeFormalizado = (payload: unknown): ContratoFormalizado => {
  const carga = payload as Partial<ContratoFormalizado>;

  if (!esUuid(carga?.id_contrato)) {
    throw new Error(
      `${TIPO_CONTRATO_FORMALIZADO} sin un id_contrato valido: ${JSON.stringify(payload)}`,
    );
  }

  const canon = Number(carga.canon);
  if (!Number.isFinite(canon) || canon <= 0) {
    throw new Error(
      `${TIPO_CONTRATO_FORMALIZADO} ${carga.id_contrato} con un canon invalido: ${String(carga.canon)}`,
    );
  }

  if (primerPeriodoDe(carga.fecha_inicio_corte) === null) {
    throw new Error(
      `${TIPO_CONTRATO_FORMALIZADO} ${carga.id_contrato} sin fecha_inicio_corte valida: ` +
        `${String(carga.fecha_inicio_corte)}`,
    );
  }

  return { ...(carga as ContratoFormalizado), canon };
};

/** Un manejador por tipo. El periodo sale de `primerPeriodoDe()`, igual que en el motor. */
export const manejadores: Record<string, Manejador> = {
  [TIPO_CONTRATO_FORMALIZADO]: async (payload, { transaccion }) => {
    const carga = cargaDeFormalizado(payload);
    // No puede ser null: `cargaDeFormalizado` ya lo comprobo y lanzo si no.
    const periodo = primerPeriodoDe(carga.fecha_inicio_corte)!;

    // Dentro de la transacción del consumidor.
    const { anunciada } = await emitirCuentaCobro(
      {
        id_contrato: carga.id_contrato,
        id_inquilino: carga.id_inquilino,
        detalle: detalleDelPeriodo(periodo),
        valor: carga.canon,
        inicio: periodo.inicio,
        fin: periodo.fin,
      },
      transaccion,
    );

    console.log(
      `🧾 ms-financiero: primera cuenta de cobro del contrato ${carga.id_contrato}` +
        ` — periodo ${periodo.inicio} a ${periodo.fin}, valor ${carga.canon}` +
        `${anunciada ? '' : ' (SIN aviso: el sobre no trae id_inquilino)'}`,
    );
  },
};

/** El consumidor del servicio: descarta repetidos y aplica el manejador. */
export const consumidor: Consumidor = crearConsumidor({
  conexion: comoConexion(sequelize),
  tabla: TABLA_PROCESADOS,
  manejadores,
});
