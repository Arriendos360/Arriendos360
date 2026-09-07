/**
 * Copia en memoria de lo que invalida tokens.
 *
 * EL PROBLEMA QUE RESUELVE. La regla dura 7 obliga a cada servicio a revalidar
 * el token por su cuenta, y revalidar de verdad incluye comprobar que la sesion
 * no se haya cerrado. Pero solo ms-identidad tiene la tabla: cualquier otro
 * servicio tendria que preguntarselo por HTTP, y hacerlo EN CADA PETICION
 * pondria un salto de red en el camino critico de toda la API y convertiria a
 * ms-identidad en punto unico de fallo — justo lo que la verificacion local de
 * la firma evita.
 *
 * La solucion es la que el Capitulo 2 fija para el gateway y aqui se generaliza:
 * una copia en memoria que se refresca cada pocos segundos. Ver `docs/adr/0008`
 * para la ventana que eso implica.
 *
 * GUARDA DOS COSAS, porque hay dos formas de invalidar un token:
 *
 * - Los `jti` revocados uno a uno, que es lo que hace el logout.
 * - Las marcas de «este usuario cambio su contrasena en tal momento», que
 *   invalidan de golpe todas sus sesiones anteriores. Es lo que hace util
 *   restablecer una contrasena: no hace falta saber cuantas sesiones ajenas hay
 *   abiertas ni cuales, cosa que por definicion no se sabe. Ver `docs/adr/0010`.
 *
 * Las dos listas son cortas por construccion: solo cubren la ultima hora,
 * porque un token no vive mas y el origen descarta el resto.
 *
 * DE DONDE SALE ESTE CODIGO. Es la generalizacion de
 * `apps/gateway/src/routing/cacheRevocados.js`, que hacia exactamente esto en
 * JavaScript y solo para el gateway. Al extraer el segundo servicio que necesita
 * lo mismo, copiarlo habria dejado dos implementaciones de una regla de
 * seguridad; el gateway pasa a consumir esta en el PR que lo desconecta de
 * Inmuebles, y entonces su copia desaparece.
 */

import type { ClaimsUsuario, TokenInvalidado } from './jwt';

/** Un `jti` que dejo de valer antes de tiempo. */
export interface EntradaRevocada {
  jti: string;
}

/** El momento desde el que los tokens de un usuario dejaron de valer. */
export interface EntradaSesion {
  sub: string;
  /** Fecha ISO. Se convierte a milisegundos al guardarla. */
  desde: string;
}

/** Lo que devuelve `GET /interno/revocados` de ms-identidad. */
export interface Invalidaciones {
  revocados?: EntradaRevocada[];
  sesiones?: EntradaSesion[];
}

export interface OpcionesCache {
  /** Como se pide la lista. Se inyecta: cada servicio la trae a su manera. */
  obtener: () => Promise<Invalidaciones>;
  /** Cada cuanto se vuelve a preguntar. Ver docs/adr/0008. */
  intervaloMs?: number;
  /** Para no escribir en la consola durante las pruebas. */
  registrar?: (mensaje: string) => void;
}

export interface EstadoCache {
  vigentes: number;
  sesionesInvalidadas: number;
  intervaloMs: number;
  ultimoExito: Date | null;
  ultimoError: string | null;
}

export interface CacheInvalidacion {
  /** Consulta en memoria, sin red ni base. Es lo que se pasa a `verificarTokenConRevocacion`. */
  tokenInvalidado: TokenInvalidado;
  /** Trae la lista y reemplaza la copia local. `false` si no pudo. */
  refrescar: () => Promise<boolean>;
  /**
   * Primera carga y arranque del refresco periodico.
   *
   * Devuelve el temporizador para que se pueda comprobar desde fuera que lleva
   * `unref()`. Sin el, un servicio que solo tuviera esta cache pendiente no
   * podria salir, y eso no se puede afirmar de otro modo desde dentro del mismo
   * proceso.
   */
  iniciar: () => Promise<NodeJS.Timeout>;
  detener: () => void;
  estado: () => EstadoCache;
}

/** Quince segundos. Ver `docs/adr/0008` para por que ese numero y no otro. */
export const INTERVALO_POR_DEFECTO_MS = 15000;

export function crearCacheInvalidacion(opciones: OpcionesCache): CacheInvalidacion {
  const intervaloMs = opciones.intervaloMs ?? INTERVALO_POR_DEFECTO_MS;
  const registrar = opciones.registrar ?? ((mensaje: string) => console.error(mensaje));

  let revocados = new Set<string>();
  /** sub -> milisegundos desde los que sus tokens dejaron de valer. */
  let sesiones = new Map<string, number>();
  let ultimoExito: Date | null = null;
  let ultimoError: string | null = null;
  let temporizador: NodeJS.Timeout | null = null;

  /**
   * Reemplazo COMPLETO, no union: asi una fila que vence desaparece sola de la
   * copia sin necesidad de barrido, igual que desaparece del origen.
   */
  const refrescar = async (): Promise<boolean> => {
    try {
      const datos = await opciones.obtener();

      revocados = new Set((datos.revocados ?? []).map((entrada) => entrada.jti));
      sesiones = new Map(
        (datos.sesiones ?? []).map((entrada) => [entrada.sub, new Date(entrada.desde).getTime()]),
      );

      ultimoExito = new Date();
      ultimoError = null;
      return true;
    } catch (error) {
      ultimoError = (error as Error).message;
      // Se conserva la ultima copia buena. La alternativa —rechazarlo todo ante
      // un fallo de red— convierte un hipo de ms-identidad en una caida total de
      // la plataforma. El riesgo que se acepta esta acotado: un token cerrado
      // durante el incidente sigue sirviendo, como mucho, hasta que expire.
      registrar(
        `No se pudo refrescar la lista de invalidaciones (ultima copia buena: ${
          ultimoExito ? ultimoExito.toISOString() : 'ninguna'
        }): ${ultimoError}`,
      );
      return false;
    }
  };

  /**
   * Recibe los claims y no solo el `jti` porque necesita `sub` e `iat` para la
   * invalidacion en bloque.
   */
  const tokenInvalidado = async (claims: ClaimsUsuario): Promise<boolean> => {
    if (!claims) {
      return false;
    }

    if (claims.jti && revocados.has(claims.jti)) {
      return true;
    }

    const desde = sesiones.get(claims.sub);
    return desde !== undefined && claims.iat !== undefined && claims.iat * 1000 < desde;
  };

  const iniciar = async (): Promise<NodeJS.Timeout> => {
    // Una primera carga inmediata, para no arrancar con la copia vacia.
    await refrescar();

    temporizador = setInterval(() => {
      void refrescar();
    }, intervaloMs);

    // No debe mantener vivo el proceso: si lo unico pendiente es este
    // temporizador, Node tiene que poder salir.
    temporizador.unref?.();

    return temporizador;
  };

  const detener = (): void => {
    if (temporizador) {
      clearInterval(temporizador);
      temporizador = null;
    }
  };

  const estado = (): EstadoCache => ({
    vigentes: revocados.size,
    sesionesInvalidadas: sesiones.size,
    intervaloMs,
    ultimoExito,
    ultimoError,
  });

  return { detener, estado, iniciar, refrescar, tokenInvalidado };
}
