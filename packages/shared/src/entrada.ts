/**
 * Lado del CONSUMIDOR: bitacora de procesados e idempotencia.
 *
 * La entrega es al-menos-una-vez (ver `salida.ts`), asi que este lado recibira
 * el mismo evento mas de una vez y tiene que dar igual. La forma de conseguirlo
 * NO es que el manejador sea idempotente por casualidad —«poner arrendado dos
 * veces no hace daño» es cierto hoy y deja de serlo en cuanto un consumidor
 * inserte una cuenta de cobro—, sino recordar que eventos ya se procesaron.
 *
 * CADA CONSUMIDOR LLEVA SU PROPIA TABLA, en su propio esquema. Dos consumidores
 * del mismo evento tienen que poder procesarlo cada uno por su lado, y una
 * tabla comun ademas volveria a acoplar servicios que este diseño separa.
 *
 * LA PIEZA CLAVE es que la marca de procesado y el efecto del manejador van EN
 * LA MISMA TRANSACCION. Marcar antes y fallar despues pierde el evento; hacer el
 * efecto y morir antes de marcar lo duplica. Dentro de una transaccion no hay
 * ninguna de las dos ventanas: o queda el efecto y la marca, o no queda nada y
 * el productor lo reintenta.
 *
 * NO SE INTENTA EXACTAMENTE-UNA-VEZ, y no por pereza: seria una transaccion
 * distribuida entre la base del productor y la del consumidor, con coordinador,
 * que es lo que el ADR 0012 descarta por presupuesto y por diseño. Lo que se
 * consigue aqui —al-menos-una-vez mas descarte de repetidos— es indistinguible
 * desde fuera y cabe en una tabla.
 */

import { type SobreDesconocido, esSobreEvento } from './eventos';
import { type ConexionSql, filasDe, validarNombreDeTabla } from './sql';

/** Lo que recibe un manejador ademas de la carga. */
export interface ContextoManejo {
  sobre: SobreDesconocido;
  /**
   * La transaccion en la que ya esta anotado el evento. El manejador DEBE
   * usarla: si escribe fuera, pierde la atomicidad que da todo el sentido a esto.
   */
  transaccion: unknown;
}

/**
 * Lo que hace un servicio con un evento.
 *
 * `payload` llega como `unknown` a proposito: viene de la red y de la tabla de
 * otro servicio, asi que el manejador tiene que mirarlo antes de creerselo
 * (regla dura 7). El tipado fuerte esta en `CargaPorTipo`, para comprobar
 * dentro del manejador; no para dar por buena la entrada.
 */
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
      // No es un error. En una coreografia el productor no sabe quien escucha,
      // asi que un tipo sin manejador significa que la suscripcion sobra, no que
      // la entrega haya fallado. Devolver error haria que el productor lo
      // reintentara hasta apartarlo, ensuciando SU tabla por una decision de
      // configuracion ajena. Se registra para que no pase inadvertido.
      registrar(`Evento ${sobre.tipo} ${sobre.id_evento} recibido sin manejador: se ignora.`);
      return { repetido: false, ignorado: true };
    }

    let repetido = false;

    await conexion.transaction(async (transaccion) => {
      // `ON CONFLICT DO NOTHING ... RETURNING` es la anotacion y la comprobacion
      // a la vez, en una sola sentencia. Consultar primero y anotar despues
      // dejaria una carrera entre dos entregas simultaneas del mismo evento;
      // asi la segunda espera al commit de la primera y se encuentra el sitio
      // ocupado.
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

      // 500 a proposito: el productor tiene que reintentarlo. Nada quedo
      // escrito, porque la anotacion se fue con la transaccion.
      return { estado: 500, cuerpo: { mensaje: 'No se pudo procesar el evento' } };
    }
  };

  const contar = async (): Promise<number> => {
    const resultado = await conexion.query(`SELECT COUNT(*)::int AS total FROM ${tabla}`);
    return filasDe<{ total: number }>(resultado)[0]?.total ?? 0;
  };

  return { contar, procesar, recibir };
}
