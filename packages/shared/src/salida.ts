/**
 * Lado del productor del bus: tabla de salida (outbox) y publicador.
 *
 * El evento se escribe en la misma transacción que el cambio de dominio, en la
 * tabla de salida del productor y en su esquema. El publicador la barre, entrega
 * y marca, con reintentos. Entrega al-menos-una-vez.
 */

import type { SobreDesconocido } from './eventos';
import { type ConexionSql, filasDe, validarNombreDeTabla } from './sql';

/** Estados posibles de una fila de la tabla de salida. */
export const SALIDA_PENDIENTE = 'pendiente';
export const SALIDA_ENTREGADO = 'entregado';
export const SALIDA_APARTADO = 'apartado';

export type EstadoSalida =
  | typeof SALIDA_PENDIENTE
  | typeof SALIDA_ENTREGADO
  | typeof SALIDA_APARTADO;

/** Una fila pendiente, tal como la necesita el publicador. */
export interface FilaSalida {
  id_evento: string;
  tipo: string;
  version: number;
  ocurrido_en: Date;
  payload: unknown;
  clave_orden: string | null;
  intentos: number;
  proximo_intento_en: Date;
}

export interface OpcionesRegistro {
  /** La transacción del cambio de dominio. */
  transaccion?: unknown;
  /**
   * Clave de ordenacion. Los eventos que la comparten se entregan en el orden
   * en que se registraron; los que no la traen, sin restriccion.
   */
  claveOrden?: string | null;
  /** Si ya existe una fila con ese `id_evento`, no anota otra (ids deterministas). */
  ignorarSiExiste?: boolean;
}

/** Lo que el publicador necesita de la tabla. */
export interface AlmacenSalida {
  registrar(sobre: SobreDesconocido, opciones?: OpcionesRegistro): Promise<void>;
  pendientes(limite: number): Promise<FilaSalida[]>;
  marcarEntregado(idEvento: string): Promise<void>;
  marcarFallo(idEvento: string, error: string, proximoIntentoEn: Date): Promise<void>;
  apartar(idEvento: string, error: string): Promise<void>;
  reencolar(idEvento: string): Promise<void>;
  contar(): Promise<{ pendientes: number; apartados: number }>;
}

/** Valida un tipo de evento para interpolarlo en SQL. */
export const validarTipoDeEvento = (tipo: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(tipo)) {
    throw new Error(`Tipo de evento no valido para SQL: ${tipo}`);
  }
  return tipo;
};

/** Implementacion SQL del almacen. Vale para cualquier productor. */
export function crearAlmacenSalidaSql(opciones: {
  conexion: ConexionSql;
  /** `esquema.tabla`. Constante del servicio, jamas un dato de entrada. */
  tabla: string;
  /**
   * Tipos cuyo `payload` se borra al marcar la fila como entregada, porque llevan
   * un secreto. El borrado va en la misma sentencia que la marca: no lo partas,
   * o el secreto podría quedar guardado.
   */
  tiposRedactados?: readonly string[];
}): AlmacenSalida {
  const tabla = validarNombreDeTabla(opciones.tabla);
  const { conexion } = opciones;

  // Fragmento del UPDATE que vacía el payload de los tipos redactados.
  const tiposRedactados = (opciones.tiposRedactados ?? []).map(validarTipoDeEvento);
  const redaccion =
    tiposRedactados.length === 0
      ? ''
      : `,
                payload = CASE WHEN tipo IN (${tiposRedactados
                  .map((tipo) => `'${tipo}'`)
                  .join(', ')})
                               THEN '{}'::JSONB ELSE payload END`;

  return {
    async registrar(sobre, opcionesRegistro = {}) {
      await conexion.query(
        `INSERT INTO ${tabla}
             (id_evento, tipo, version, ocurrido_en, payload, clave_orden)
         VALUES (:id_evento, :tipo, :version, :ocurrido_en, CAST(:payload AS JSONB), :clave_orden)
         ${opcionesRegistro.ignorarSiExiste ? 'ON CONFLICT (id_evento) DO NOTHING' : ''}`,
        {
          replacements: {
            id_evento: sobre.id_evento,
            tipo: sobre.tipo,
            version: sobre.version,
            ocurrido_en: sobre.ocurrido_en,
            payload: JSON.stringify(sobre.payload),
            clave_orden: opcionesRegistro.claveOrden ?? null,
          },
          // Sin transacción, el evento se escribiría fuera del cambio de dominio.
          transaction: opcionesRegistro.transaccion,
        },
      );
    },

    async pendientes(limite) {
      // Todas las pendientes, también las que esperan reintento: frenan a las de
      // su misma clave. El filtro por `proximo_intento_en` lo aplica el publicador.
      const resultado = await conexion.query(
        `SELECT id_evento, tipo, version, ocurrido_en, payload, clave_orden,
                intentos, proximo_intento_en
           FROM ${tabla}
          WHERE estado = '${SALIDA_PENDIENTE}'
          ORDER BY registrado_en ASC, id_evento ASC
          LIMIT :limite`,
        { replacements: { limite } },
      );

      return filasDe<FilaSalida>(resultado);
    },

    async marcarEntregado(idEvento) {
      // Marca y redacta en una sola sentencia. Ver `tiposRedactados`.
      await conexion.query(
        `UPDATE ${tabla}
            SET estado = '${SALIDA_ENTREGADO}',
                entregado_en = NOW(),
                intentos = intentos + 1,
                ultimo_error = NULL${redaccion}
          WHERE id_evento = :id_evento`,
        { replacements: { id_evento: idEvento } },
      );
    },

    async marcarFallo(idEvento, error, proximoIntentoEn) {
      await conexion.query(
        `UPDATE ${tabla}
            SET intentos = intentos + 1,
                ultimo_error = :error,
                proximo_intento_en = :proximo
          WHERE id_evento = :id_evento`,
        {
          replacements: {
            id_evento: idEvento,
            error: error.slice(0, 1000),
            proximo: proximoIntentoEn.toISOString(),
          },
        },
      );
    },

    async apartar(idEvento, error) {
      await conexion.query(
        `UPDATE ${tabla}
            SET estado = '${SALIDA_APARTADO}',
                intentos = intentos + 1,
                ultimo_error = :error
          WHERE id_evento = :id_evento`,
        { replacements: { id_evento: idEvento, error: error.slice(0, 1000) } },
      );
    },

    async reencolar(idEvento) {
      // Devuelve un evento apartado a la cola. Operación manual.
      await conexion.query(
        `UPDATE ${tabla}
            SET estado = '${SALIDA_PENDIENTE}',
                intentos = 0,
                proximo_intento_en = NOW(),
                ultimo_error = NULL
          WHERE id_evento = :id_evento`,
        { replacements: { id_evento: idEvento } },
      );
    },

    async contar() {
      const resultado = await conexion.query(
        `SELECT estado, COUNT(*)::int AS total FROM ${tabla} GROUP BY estado`,
      );

      const filas = filasDe<{ estado: string; total: number }>(resultado);
      const de = (estado: string): number =>
        filas.find((fila) => fila.estado === estado)?.total ?? 0;

      return { pendientes: de(SALIDA_PENDIENTE), apartados: de(SALIDA_APARTADO) };
    },
  };
}

/** Entrega un sobre. Lanza si no pudo; el publicador decide que hacer. */
export type Entregar = (sobre: SobreDesconocido) => Promise<void>;

export interface OpcionesPublicador {
  almacen: AlmacenSalida;
  entregar: Entregar;
  /** Cada cuanto se barre la tabla. */
  intervaloMs?: number;
  /** Cuantas filas se miran por ciclo. */
  tamanoLote?: number;
  /** Intentos antes de apartar el evento. */
  maxIntentos?: number;
  esperaBaseMs?: number;
  esperaMaximaMs?: number;
  registrar?: (mensaje: string) => void;
  /** Inyectable para que las pruebas no dependan del reloj. */
  ahora?: () => Date;
}

export interface ResultadoCiclo {
  entregados: number;
  fallidos: number;
  apartados: number;
  /** Vistos pero no intentados: esperando su reintento o su predecesor. */
  aplazados: number;
}

export interface EstadoPublicador {
  intervaloMs: number;
  maxIntentos: number;
  ultimoCiclo: Date | null;
  entregadosEnTotal: number;
  apartadosEnTotal: number;
}

export interface Publicador {
  /** Un barrido. Expuesto para que las pruebas no dependan de temporizadores. */
  ciclo: () => Promise<ResultadoCiclo>;
  iniciar: () => Promise<NodeJS.Timeout>;
  detener: () => void;
  estado: () => EstadoPublicador;
}

/** Intervalo entre barridos. */
export const INTERVALO_PUBLICACION_MS = 5000;
export const TAMANO_LOTE_POR_DEFECTO = 50;

/** Diez intentos con espera creciente: ~13 minutos antes de apartar un evento. */
export const MAX_INTENTOS_POR_DEFECTO = 10;
export const ESPERA_BASE_MS = 2000;
export const ESPERA_MAXIMA_MS = 300000;

/**
 * Publicador: lee la tabla, entrega y marca.
 *
 * - Los eventos con la misma `clave_orden` salen en el orden en que se
 *   registraron; uno que falla sólo frena a los de su clave.
 * - Tras `maxIntentos` con espera creciente, la fila pasa a `apartado`: deja de
 *   intentarse y de bloquear su clave. `reencolar()` la devuelve a la cola.
 */
export function crearPublicador(opciones: OpcionesPublicador): Publicador {
  const intervaloMs = opciones.intervaloMs ?? INTERVALO_PUBLICACION_MS;
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE_POR_DEFECTO;
  const maxIntentos = opciones.maxIntentos ?? MAX_INTENTOS_POR_DEFECTO;
  const esperaBaseMs = opciones.esperaBaseMs ?? ESPERA_BASE_MS;
  const esperaMaximaMs = opciones.esperaMaximaMs ?? ESPERA_MAXIMA_MS;
  const registrar = opciones.registrar ?? ((mensaje: string) => console.error(mensaje));
  const ahora = opciones.ahora ?? (() => new Date());

  let temporizador: NodeJS.Timeout | null = null;
  let ultimoCiclo: Date | null = null;
  let entregadosEnTotal = 0;
  let apartadosEnTotal = 0;

  /** Espera exponencial con tope: 2s, 4s, 8s... hasta 5 min. */
  const esperaTras = (intentos: number): number =>
    Math.min(esperaBaseMs * 2 ** Math.max(0, intentos - 1), esperaMaximaMs);

  const sobreDe = (fila: FilaSalida): SobreDesconocido => ({
    id_evento: fila.id_evento,
    tipo: fila.tipo,
    version: fila.version,
    ocurrido_en: new Date(fila.ocurrido_en).toISOString(),
    payload: fila.payload,
  });

  const ciclo = async (): Promise<ResultadoCiclo> => {
    const resultado: ResultadoCiclo = {
      entregados: 0,
      fallidos: 0,
      apartados: 0,
      aplazados: 0,
    };

    let filas: FilaSalida[];
    try {
      filas = await opciones.almacen.pendientes(tamanoLote);
    } catch (error) {
      registrar(`No se pudo leer la tabla de salida: ${(error as Error).message}`);
      return resultado;
    }

    const momento = ahora();
    /** Claves cuyo evento mas antiguo no ha salido: lo que va detras espera. */
    const frenadas = new Set<string>();

    for (const fila of filas) {
      const clave = fila.clave_orden;

      if (clave !== null && frenadas.has(clave)) {
        resultado.aplazados += 1;
        continue;
      }

      if (new Date(fila.proximo_intento_en).getTime() > momento.getTime()) {
        // Todavia esta cumpliendo su espera. Frena a los suyos, no a los demas.
        if (clave !== null) {
          frenadas.add(clave);
        }
        resultado.aplazados += 1;
        continue;
      }

      try {
        await opciones.entregar(sobreDe(fila));
        await opciones.almacen.marcarEntregado(fila.id_evento);
        resultado.entregados += 1;
        entregadosEnTotal += 1;
      } catch (error) {
        const mensaje = (error as Error).message;
        const intentos = fila.intentos + 1;

        if (intentos >= maxIntentos) {
          await opciones.almacen.apartar(fila.id_evento, mensaje);
          resultado.apartados += 1;
          apartadosEnTotal += 1;
          registrar(
            `⛔ Evento ${fila.tipo} ${fila.id_evento} APARTADO tras ${intentos} intentos: ${mensaje}. ` +
              'Deja de entregarse y deja de bloquear su clave de orden; queda en la tabla de salida para revision.',
          );
          // Apartar desbloquea la clave: no se frena.
          continue;
        }

        await opciones.almacen.marcarFallo(
          fila.id_evento,
          mensaje,
          new Date(momento.getTime() + esperaTras(intentos)),
        );
        resultado.fallidos += 1;

        if (clave !== null) {
          frenadas.add(clave);
        }

        registrar(
          `⚠️  Entrega fallida de ${fila.tipo} ${fila.id_evento} ` +
            `(intento ${intentos}/${maxIntentos}): ${mensaje}`,
        );
      }
    }

    ultimoCiclo = momento;
    return resultado;
  };

  const iniciar = async (): Promise<NodeJS.Timeout> => {
    // Primer barrido inmediato, para lo que quedó pendiente.
    await ciclo();

    temporizador = setInterval(() => {
      void ciclo();
    }, intervaloMs);

    // No mantiene vivo el proceso.
    temporizador.unref?.();

    return temporizador;
  };

  const detener = (): void => {
    if (temporizador) {
      clearInterval(temporizador);
      temporizador = null;
    }
  };

  const estado = (): EstadoPublicador => ({
    intervaloMs,
    maxIntentos,
    ultimoCiclo,
    entregadosEnTotal,
    apartadosEnTotal,
  });

  return { ciclo, detener, estado, iniciar };
}
