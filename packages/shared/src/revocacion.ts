/**
 * Copia en memoria de lo que invalida tokens —`jti` revocados y cambios de
 * contraseña por usuario—, refrescada periódicamente desde ms-identidad.
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
  /** Cada cuánto se vuelve a preguntar. */
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
  /** Primera carga y arranque del refresco. Devuelve el temporizador (con `unref()`). */
  iniciar: () => Promise<NodeJS.Timeout>;
  detener: () => void;
  estado: () => EstadoCache;
}

/** Intervalo de refresco por defecto. */
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

  /** Reemplaza la copia entera, de modo que lo vencido desaparece solo. */
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
      // Ante un fallo se conserva la última copia buena.
      registrar(
        `No se pudo refrescar la lista de invalidaciones (ultima copia buena: ${
          ultimoExito ? ultimoExito.toISOString() : 'ninguna'
        }): ${ultimoError}`,
      );
      return false;
    }
  };

  /** Invalidado si su `jti` está revocado o su `iat` es anterior al cambio de contraseña. */
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

  const estado = (): EstadoCache => ({
    vigentes: revocados.size,
    sesionesInvalidadas: sesiones.size,
    intervaloMs,
    ultimoExito,
    ultimoError,
  });

  return { detener, estado, iniciar, refrescar, tokenInvalidado };
}
