/**
 * MS-Inmuebles como consumidor: `ContratoFormalizado` pone el inmueble en
 * `arrendado` y `ContratoFinalizado` en `disponible`. Los cambios se auditan como
 * del sistema.
 */

import {
  TIPO_CONTRATO_FINALIZADO,
  TIPO_CONTRATO_FORMALIZADO,
  type ContratoFinalizado,
  type ContratoFormalizado,
  type Consumidor,
  type Manejador,
  comoConexion,
  crearConsumidor,
} from 'arriendos360-shared';
import type { EstadoInmueble } from 'arriendos360-contracts';

import { ESQUEMA, sequelize } from '../config/database';
import { Inmueble } from '../models/Inmueble';
import { esUuid } from '../models/uuid';

/** Bitácora de eventos procesados de este consumidor. */
export const TABLA_PROCESADOS = `${ESQUEMA}.eventos_procesados`;

/**
 * Mueve el estado dentro de la transacción del consumidor, por instancia para que
 * corran los hooks de auditoría. Un inmueble que no existe se registra y se ignora.
 */
const moverEstado = async (
  idInmueble: string,
  estado: EstadoInmueble,
  transaccion: unknown,
): Promise<void> => {
  const inmueble = await Inmueble.findByPk(idInmueble, {
    transaction: transaccion as never,
  });

  if (!inmueble) {
    console.warn(
      `Evento sobre el inmueble ${idInmueble}, que no existe en este servicio: se ignora.`,
    );
    return;
  }

  await inmueble.update({ estado }, { transaction: transaccion as never });
};

/**
 * Lee el `id_inmueble` de la carga. Lanza si no es un UUID, para que el evento
 * acabe apartado a la vista.
 */
const inmuebleDe = (payload: unknown, tipo: string): string => {
  const carga = payload as Partial<ContratoFormalizado & ContratoFinalizado>;

  if (!esUuid(carga?.id_inmueble)) {
    throw new Error(`${tipo} sin un id_inmueble valido: ${JSON.stringify(payload)}`);
  }

  return carga.id_inmueble as string;
};

/** Un manejador por tipo. */
export const manejadores: Record<string, Manejador> = {
  [TIPO_CONTRATO_FORMALIZADO]: async (payload, { transaccion }) => {
    await moverEstado(inmuebleDe(payload, TIPO_CONTRATO_FORMALIZADO), 'arrendado', transaccion);
  },

  [TIPO_CONTRATO_FINALIZADO]: async (payload, { transaccion }) => {
    await moverEstado(inmuebleDe(payload, TIPO_CONTRATO_FINALIZADO), 'disponible', transaccion);
  },
};

/** El consumidor del servicio: descarta repetidos y aplica el manejador. */
export const consumidor: Consumidor = crearConsumidor({
  conexion: comoConexion(sequelize),
  tabla: TABLA_PROCESADOS,
  manejadores,
});
