/**
 * Lado del consumidor del bus: descarta eventos repetidos anotando cada
 * `id_evento` en la misma transacción que el efecto del manejador.
 */

import { type SobreDesconocido, esSobreEvento } from './eventos';
import { type ConexionSql, filasDe, validarNombreDeTabla } from './sql';

/** Lo que recibe un manejador ademas de la carga. */
export interface ContextoManejo {
  sobre: SobreDesconocido;
  /** Transacción donde ya está anotado el evento. El manejador debe escribir en ella. */
  transaccion: unknown;
}

/** Lo que hace un servicio con un evento. `payload` llega sin validar. */
export type Manejador = (payload: unknown, contexto: ContextoManejo) => Promise<void>;

export interface OpcionesConsumidor {
  conexion: ConexionSql;
  /** `esquema.tabla`. Constante del servicio. */
  tabla: string;
  /** Un manejador por tipo de evento. Los tipos sin manejador se ignoran. */
  manejadores: Record<string, Manejador>;
  registrar?: (mensaje: string) => void;
}

export interface ResultadoProceso {
  /** `true` si ya estaba anotado: no se volvio a ejecutar nada. */
  repetido: boolean;
  /** `true` si el tipo no tiene manejador en este servicio. */
  ignorado: boolean;
}

/** Respuesta lista para devolver, sin depender de ningun framework HTTP. */
export interface RespuestaEvento {
  estado: number;
  cuerpo: Record<string, unknown>;
}

export interface Consumidor {
  /** Procesa un sobre ya validado. Lanza si el manejador lanza. */
  procesar: (sobre: SobreDesconocido) => Promise<ResultadoProceso>;
  /** Envoltorio para un endpoint HTTP: valida, procesa y traduce a codigos. */
  recibir: (cuerpo: unknown) => Promise<RespuestaEvento>;
  /** Para diagnostico: cuantos eventos lleva anotados. */
  contar: () => Promise<number>;
}

export function crearConsumidor(opciones: OpcionesConsumidor): Consumidor {
  const tabla = validarNombreDeTabla(opciones.tabla);
  const { conexion } = opciones;
  const registrar = opciones.registrar ?? ((mensaje: string) => console.error(mensaje));

  const procesar = async (sobre: SobreDesconocido): Promise<ResultadoProceso> => {
    const manejador = opciones.manejadores[sobre.tipo];

    if (!manejador) {
      // Se acepta y se registra: devolver error haría que el productor lo reintentara.
      registrar(`Evento ${sobre.tipo} ${sobre.id_evento} recibido sin manejador: se ignora.`);
      return { repetido: false, ignorado: true };
    }

    let repetido = false;

    await conexion.transaction(async (transaccion) => {
      // Anota y comprueba en una sola sentencia, sin carrera entre entregas simultáneas.
      const resultado = await conexion.query(
        `INSERT INTO ${tabla} (id_evento, tipo)
         VALUES (:id_evento, :tipo)
         ON CONFLICT (id_evento) DO NOTHING
         RETURNING id_evento`,
        {
          replacements: { id_evento: sobre.id_evento, tipo: sobre.tipo },
          transaction: transaccion,
        },
      );

      if (filasDe<{ id_evento: string }>(resultado).length === 0) {
        repetido = true;
        return;
      }

      await manejador(sobre.payload, { sobre, transaccion });
    });

    return { repetido, ignorado: false };
  };

  const recibir = async (cuerpo: unknown): Promise<RespuestaEvento> => {
    if (!esSobreEvento(cuerpo)) {
      return { estado: 400, cuerpo: { mensaje: 'Sobre de evento mal formado' } };
    }

    try {
      const resultado = await procesar(cuerpo);

      return {
        estado: 200,
        cuerpo: {
          mensaje: resultado.ignorado
            ? 'Evento sin manejador en este servicio'
            : resultado.repetido
              ? 'Evento ya procesado'
              : 'Evento procesado',
          ...resultado,
        },
      };
    } catch (error) {
      const mensaje = (error as Error).message;
      registrar(`Error al procesar ${cuerpo.tipo} ${cuerpo.id_evento}: ${mensaje}`);

      // 500 para que el productor reintente; la transacción no dejó nada escrito.
      return { estado: 500, cuerpo: { mensaje: 'No se pudo procesar el evento' } };
    }
  };

  const contar = async (): Promise<number> => {
    const resultado = await conexion.query(`SELECT COUNT(*)::int AS total FROM ${tabla}`);
    return filasDe<{ total: number }>(resultado)[0]?.total ?? 0;
  };

  return { contar, procesar, recibir };
}
