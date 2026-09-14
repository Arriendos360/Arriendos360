/**
 * Lado del PRODUCTOR: tabla de salida (outbox) y publicador.
 *
 * EL PROBLEMA. Guardar el contrato en PostgreSQL y avisar por la red son dos
 * cosas que no se pueden hacer a la vez. Si se avisa primero y la escritura
 * falla, se anuncio un hecho que no ocurrio; si se escribe primero y el aviso
 * falla, el hecho ocurrio y nadie se entero. Es exactamente la garantia que el
 * ADR 0011 dio por perdida al extraer ms-inmuebles.
 *
 * LA SOLUCION. El evento se escribe como una fila mas, EN LA MISMA TRANSACCION
 * que el cambio de dominio. Las dos escrituras van a la misma base, asi que o
 * quedan las dos o no queda ninguna: la atomicidad vuelve a estar disponible.
 * Lo que sale a la red lo hace despues, desde un proceso aparte que lee la
 * tabla, entrega y marca. Si la entrega falla, reintenta; el evento no se
 * pierde porque ya esta en disco.
 *
 * UNA TABLA DE SALIDA POR PRODUCTOR, EN SU PROPIO ESQUEMA. Nunca compartida. Una
 * tabla comun seria un punto de acoplamiento entre servicios que la regla dura 3
 * prohibe, y ademas romperia lo unico que hace que esto funcione: que la tabla
 * de salida y las tablas de dominio del productor esten en la misma base y
 * quepan en una transaccion. Por eso `tabla` es un parametro.
 *
 * ENTREGA AL-MENOS-UNA-VEZ, y no se intenta otra cosa. Entre «entregar» y
 * «marcar entregado» hay una ventana, y un corte ahi provoca una segunda
 * entrega. Cerrarla exigiria una transaccion distribuida entre la base del
 * productor y el consumidor, que es justo lo que este diseño evita. La otra
 * mitad del trato esta en `entrada.ts`: el consumidor descarta repetidos.
 *
 * ORDEN Y BLOQUEO: ver la nota de `crearPublicador`.
 *
 * PAYLOAD REDACTADO AL ENTREGAR: ver `tiposRedactados`. Lo agrega el paso 7,
 * porque el token de recuperacion de contrasena viaja dentro de un sobre y no
 * puede quedarse en esta tabla despues de haberse entregado.
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
  /**
   * La transaccion del cambio de dominio. Sin ella esto no sirve para nada: el
   * evento se guardaria aparte y volveriamos al problema original.
   */
  transaccion?: unknown;
  /**
   * Clave de ordenacion. Los eventos que la comparten se entregan en el orden
   * en que se registraron; los que no la traen, sin restriccion.
   */
  claveOrden?: string | null;
}

/**
 * Lo que el publicador necesita de la tabla. Se declara como puerto para poder
 * probar el publicador sin base —igual que `crearCacheInvalidacion` recibe su
 * `obtener`— pero la implementacion SQL viene incluida: el objetivo es que el
 * siguiente servicio herede el mecanismo, no que lo reimplemente.
 */
export interface AlmacenSalida {
  registrar(sobre: SobreDesconocido, opciones?: OpcionesRegistro): Promise<void>;
  pendientes(limite: number): Promise<FilaSalida[]>;
  marcarEntregado(idEvento: string): Promise<void>;
  marcarFallo(idEvento: string, error: string, proximoIntentoEn: Date): Promise<void>;
  apartar(idEvento: string, error: string): Promise<void>;
  reencolar(idEvento: string): Promise<void>;
  contar(): Promise<{ pendientes: number; apartados: number }>;
}

/**
 * Valida un nombre de tipo de evento para poder interpolarlo en SQL.
 *
 * Los tipos son constantes del codigo —`'RecuperacionSolicitada'`— nunca un dato
 * de entrada, igual que el nombre de la tabla. Se valida por la misma razon que
 * aquel: que hoy sea una constante no impide que mañana alguien la pase desde
 * una variable de entorno, y entonces el error seria una inyeccion.
 */
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
   * Tipos cuyo `payload` se BORRA al marcar la fila como entregada.
   *
   * ── POR QUE EXISTE ESTO ────────────────────────────────────────────────────
   *
   * Un sobre puede llevar un secreto. `RecuperacionSolicitada` lleva el token de
   * restablecimiento EN CLARO, porque el consumidor necesita construir con el el
   * enlace del correo — mientras `identidad.tokens_recuperacion` guarda solo su
   * SHA-256 justamente para que leer la tabla no permita restablecer la
   * contrasena de nadie. Dejar el token en esta tabla despues de entregarlo
   * anularia esa precaucion por la puerta de atras, y para siempre: las filas
   * entregadas no se borran.
   *
   * ── Y POR QUE VA DENTRO DEL MISMO UPDATE ───────────────────────────────────
   *
   * Esto es lo que importa, y es la razon de que no sea una segunda llamada. Si
   * borrar el payload fuera una operacion aparte, una caida entre las dos —o un
   * fallo de la segunda— dejaria la fila marcada como entregada y el token en
   * claro ahi indefinidamente, que es exactamente el estado que se quiere
   * evitar. Una sola sentencia no tiene ese hueco: o marca y borra, o no hace
   * ninguna de las dos cosas.
   *
   * Se pierde la carga de los eventos entregados de esos tipos, y se acepta: la
   * constancia de que el hecho ocurrio esta en la fila —`id_evento`, `tipo`,
   * `ocurrido_en`, `entregado_en`— y el dato de dominio, en el agregado del
   * emisor. Lo unico que desaparece es el secreto.
   *
   * Los tipos NO redactados conservan su payload intacto, que es lo que permite
   * mirar un evento entregado cuando algo no cuadra.
   */
  tiposRedactados?: readonly string[];
}): AlmacenSalida {
  const tabla = validarNombreDeTabla(opciones.tabla);
  const { conexion } = opciones;

  // El fragmento se arma UNA vez, al crear el almacen, con los tipos validados.
  // Sin tipos que redactar queda vacio y el UPDATE es exactamente el de antes
  // del paso 7, que es lo que se quiere para los productores que no llevan
  // secretos en el sobre.
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
         VALUES (:id_evento, :tipo, :version, :ocurrido_en, CAST(:payload AS JSONB), :clave_orden)`,
        {
          replacements: {
            id_evento: sobre.id_evento,
            tipo: sobre.tipo,
            version: sobre.version,
            ocurrido_en: sobre.ocurrido_en,
            payload: JSON.stringify(sobre.payload),
            clave_orden: opcionesRegistro.claveOrden ?? null,
          },
          // Si viene `undefined`, Sequelize usa la conexion suelta: es
          // justamente lo que NO queremos, y por eso el llamante siempre la pasa.
          transaction: opcionesRegistro.transaccion,
        },
      );
    },

    async pendientes(limite) {
      // Se piden TODAS las pendientes por antiguedad, no solo las vencidas: una
      // fila que espera su reintento tiene que seguir viendose para poder
      // frenar a las que van detras con su misma clave de orden. El filtro por
      // `proximo_intento_en` lo aplica el publicador, que es quien conoce esa
      // regla.
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
      // El borrado del payload va DENTRO de este UPDATE, no en una segunda
      // sentencia. Ver `tiposRedactados`.
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
      // La salida del apartado, para cuando se arregla la causa. Es una
      // operacion de operacion, no de negocio: la ejecuta una persona.
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
  /** Intentos antes de apartar el evento. Ver la nota sobre veneno. */
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

/** Cinco segundos. La ventana de consistencia esperada, no un limite duro. */
export const INTERVALO_PUBLICACION_MS = 5000;
export const TAMANO_LOTE_POR_DEFECTO = 50;

/**
 * Diez intentos con espera creciente: ~13 minutos antes de apartar un evento.
 * Ver la nota sobre veneno en `crearPublicador`.
 */
export const MAX_INTENTOS_POR_DEFECTO = 10;
export const ESPERA_BASE_MS = 2000;
export const ESPERA_MAXIMA_MS = 300000;

/**
 * Publicador: lee la tabla, entrega y marca.
 *
 * ORDEN POR CLAVE, NO GLOBAL. Los eventos que comparten `clave_orden` se
 * entregan en el orden en que se registraron. Hace falta de verdad y no es
 * adorno: `ContratoFormalizado` y `ContratoFinalizado` sobre el mismo inmueble
 * son ordenes contrarias —ocupalo, liberalo— y entregarlas al reves deja el
 * inmueble ocupado para siempre. Sin clave, cada evento va por su cuenta.
 *
 * QUE PASA CON UN EVENTO QUE FALLA SIEMPRE. Dos mecanismos, porque el problema
 * tiene dos mitades:
 *
 * 1. **No bloquea la cola.** Un evento fallido solo frena a los que comparten su
 *    clave de orden —los de otro inmueble siguen saliendo— y el resto del lote
 *    se intenta igual en el mismo ciclo. Reducir el bloqueo a lo que la
 *    correccion exige, y ni un caso mas, es lo que evita que un dato malo
 *    paralice el sistema entero.
 *
 * 2. **No se reintenta para siempre.** Tras `maxIntentos` con espera creciente,
 *    la fila pasa a `apartado` con su ultimo error guardado: deja de intentarse,
 *    deja de bloquear su clave y queda a la vista para que una persona decida.
 *    Se APARTA, no se borra: el evento describe un hecho que ocurrio de verdad,
 *    y tirarlo seria perder la unica constancia de que el consumidor no se
 *    entero. `reencolar()` lo devuelve a la cola cuando se arregla la causa.
 *
 * EL CRITERIO detras de ese numero. Una entrega falla por dos motivos muy
 * distintos: el consumidor esta caido —transitorio, se arregla solo— o el
 * evento le sienta mal —permanente, no se arregla reintentando—. Desde fuera no
 * se distinguen, asi que el limite se elige por TIEMPO y no por naturaleza del
 * fallo: ~13 minutos es de sobra para un reinicio de contenedor o un despliegue,
 * y lo bastante poco para que un evento envenenado no siga ahi cuando alguien
 * mire. Apartar prematuramente un evento por una caida larga es un fallo
 * reparable —se reencola—; reintentar sin fin uno envenenado no lo es, porque
 * nadie se entera nunca.
 *
 * VARIAS REPLICAS. Dos publicadores sobre la misma tabla pueden entregar el
 * mismo evento a la vez. No se pone un `FOR UPDATE SKIP LOCKED` porque la
 * consecuencia ya esta cubierta: la entrega es al-menos-una-vez por diseño y el
 * consumidor descarta repetidos. Lo que si haria falta el dia que haya varias
 * replicas es revisar el orden por clave, que un bloqueo por fila si afectaria.
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
          // A proposito NO se frena la clave: apartar es, ademas, lo que la
          // desbloquea. El precio es que el consumidor puede ver un evento sin
          // su predecesor, y por eso se registra tan alto.
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
    // Un primer barrido inmediato: si el proceso se cayo con eventos sin
    // entregar, salen ahora y no dentro de un intervalo.
    await ciclo();

    temporizador = setInterval(() => {
      void ciclo();
    }, intervaloMs);

    // No debe mantener vivo el proceso, igual que la cache de invalidacion.
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
