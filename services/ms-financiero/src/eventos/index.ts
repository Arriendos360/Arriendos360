/**
 * MS-Financiero como consumidor: `ContratoFormalizado` crea la primera cuenta de
 * cobro, o las que falten en un contrato que ya corría, y anota `CuentaCobroGenerada`
 * o, por las ya vencidas, un solo `CuentasAtrasadasRegistradas`, en la misma
 * transacción que marca el evento como procesado. `ContratoFinalizado`
 * no tiene manejador: finalizar no cancela lo que se debe.
 */

import type { Transaction } from 'sequelize';
import {
  TIPO_CONTRATO_FORMALIZADO,
  type ContratoFormalizado,
  type Consumidor,
  type Manejador,
  type Periodo,
  comoConexion,
  crearConsumidor,
  diaDeCorte,
  diaEnZonaNegocio,
  hoyEnZonaNegocio,
  periodosPendientes,
  soloFecha,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';
import { CuentaCobro } from '../models/CuentaCobro';
import { esUuid } from '../models/uuid';
import { emitirCuentaCobro } from '../services/cuentas';
import { detalleDelPeriodo, esAtrasada, primerPeriodoDe } from '../services/motor';
import { registrarCuentasAtrasadasRegistradas } from './salida';

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

  if (carga.ultimo_periodo_pagado !== undefined && soloFecha(carga.ultimo_periodo_pagado) === null) {
    throw new Error(
      `${TIPO_CONTRATO_FORMALIZADO} ${carga.id_contrato} con un ultimo_periodo_pagado invalido: ` +
        `${String(carga.ultimo_periodo_pagado)}`,
    );
  }

  return { ...(carga as ContratoFormalizado), canon };
};

/** Lo que este evento factura: el primer periodo o, si el contrato ya corría, lo que falte desde el último pagado. */
const periodosDe = (carga: ContratoFormalizado): Periodo[] =>
  // No pueden ser null: `cargaDeFormalizado` ya lo comprobó y lanzó si no.
  carga.ultimo_periodo_pagado
    ? periodosPendientes(diaDeCorte(carga.fecha_inicio_corte)!, carga.ultimo_periodo_pagado, hoyEnZonaNegocio())
    : [primerPeriodoDe(carga.fecha_inicio_corte)!];

/** Un manejador por tipo. Los periodos salen del mismo calendario que usa el motor. */
export const manejadores: Record<string, Manejador> = {
  [TIPO_CONTRATO_FORMALIZADO]: async (payload, { sobre, transaccion }) => {
    const carga = cargaDeFormalizado(payload);
    const periodos = periodosDe(carga);

    // Si el evento se demoró, el motor pudo adelantarse con alguna: chocar con el índice lo reintentaría sin fin.
    const existentes = carga.ultimo_periodo_pagado
      ? await CuentaCobro.findAll({
          attributes: ['inicio'],
          where: { id_contrato: carga.id_contrato, inicio: periodos.map((periodo) => periodo.inicio) },
          transaction: transaccion as Transaction,
        })
      : [];
    const yaEmitidos = new Set(existentes.map((cuenta) => cuenta.inicio));

    const porEmitir = periodos.filter(({ inicio }) => !yaEmitidos.has(inicio));

    // Atrasadas: las vencidas al formalizar. Un solo resumen, en lugar de un recibo por cada una.
    const formalizado = diaEnZonaNegocio(new Date(sobre.ocurrido_en));
    const atrasadas = carga.ultimo_periodo_pagado
      ? porEmitir.filter(({ inicio }) => esAtrasada(inicio, formalizado))
      : [];

    for (const periodo of porEmitir) {
      // Dentro de la transacción del consumidor.
      const { anunciada } = await emitirCuentaCobro(
        {
          id_contrato: carga.id_contrato,
          id_inquilino: carga.id_inquilino,
          sinAviso: atrasadas.includes(periodo),
          detalle: detalleDelPeriodo(periodo),
          valor: carga.canon,
          inicio: periodo.inicio,
          fin: periodo.fin,
        },
        transaccion,
      );

      console.log(
        `🧾 ms-financiero: cuenta de cobro del contrato ${carga.id_contrato}` +
          ` — periodo ${periodo.inicio} a ${periodo.fin}, valor ${carga.canon}` +
          `${anunciada ? '' : ' (sin aviso propio)'}`,
      );
    }

    if (atrasadas.length > 0 && carga.id_inquilino) {
      await registrarCuentasAtrasadasRegistradas(
        {
          id_contrato: carga.id_contrato,
          id_inquilino: carga.id_inquilino,
          cantidad: atrasadas.length,
          total: Number((carga.canon * atrasadas.length).toFixed(2)),
          primer_periodo: atrasadas[0]!.inicio,
          ultimo_periodo: atrasadas.at(-1)!.fin,
        },
        transaccion,
      );
    }
  },
};

/** El consumidor del servicio: descarta repetidos y aplica el manejador. */
export const consumidor: Consumidor = crearConsumidor({
  conexion: comoConexion(sequelize),
  tabla: TABLA_PROCESADOS,
  manejadores,
});
