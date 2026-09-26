/**
 * Transporte del bus: entrega cada sobre por `POST /interno/eventos` a los
 * suscriptores configurados. La fila se marca entregada cuando todos aceptan.
 */

import type { SobreDesconocido } from './eventos';
import type { Entregar } from './salida';
import { cabeceraDeServicio } from './servicio';

/** Un servicio que escucha. `url` es su base, sin la ruta. */
export interface Suscriptor {
  nombre: string;
  url: string;
}

export interface OpcionesEntregaHttp {
  /** Quién escucha un tipo. Se consulta en cada entrega. */
  suscriptores: (tipo: string) => Suscriptor[];
  /** Nombre de ESTE servicio, para el `iss` del token de servicio. */
  emisor: () => string;
  secreto: () => string | undefined;
  /** Ruta del endpoint receptor en el suscriptor. */
  ruta?: string;
  timeoutMs?: number;
  registrar?: (mensaje: string) => void;
}

/** Ruta convenida del receptor de eventos. Bajo `/interno`: la llama un servicio. */
export const RUTA_EVENTOS = '/interno/eventos';

/** Tiempo límite de cada entrega. */
export const TIMEOUT_ENTREGA_MS = 10000;

const unir = (base: string, ruta: string): string => `${base.replace(/\/+$/, '')}${ruta}`;

/**
 * Construye la función de entrega del publicador. Lanza con los suscriptores que
 * no aceptaron.
 */
export function crearEntregaHttp(opciones: OpcionesEntregaHttp): Entregar {
  const ruta = opciones.ruta ?? RUTA_EVENTOS;
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_ENTREGA_MS;
  const registrar = opciones.registrar ?? ((mensaje: string) => console.warn(mensaje));

  const entregarA = async (suscriptor: Suscriptor, sobre: SobreDesconocido): Promise<void> => {
    const url = unir(suscriptor.url, ruta);

    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...cabeceraDeServicio({
          emisor: opciones.emisor(),
          destinatario: suscriptor.nombre,
          secreto: opciones.secreto(),
        }),
      },
      body: JSON.stringify(sobre),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!respuesta.ok) {
      throw new Error(`${suscriptor.nombre} respondio ${respuesta.status}`);
    }
  };

  return async function entregar(sobre: SobreDesconocido): Promise<void> {
    const destinos = opciones.suscriptores(sobre.tipo);

    if (destinos.length === 0) {
      // Sin suscriptores se da por entregado, y queda en el log.
      registrar(
        `Evento ${sobre.tipo} ${sobre.id_evento} sin suscriptores configurados: se da por entregado.`,
      );
      return;
    }

    const fallos: string[] = [];

    for (const destino of destinos) {
      try {
        await entregarA(destino, sobre);
      } catch (error) {
        fallos.push(`${destino.nombre}: ${(error as Error).message}`);
      }
    }

    if (fallos.length > 0) {
      throw new Error(fallos.join('; '));
    }
  };
}
