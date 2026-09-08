/**
 * El transporte: como sale un evento de la tabla de salida hacia quien escucha.
 *
 * Es un POST a `/interno/eventos` del suscriptor, con la misma credencial de
 * servicio que el resto de `/interno` (`cabeceraDeServicio`). No hay broker: la
 * durabilidad y el reintento los pone la tabla de salida en PostgreSQL, y lo
 * unico que falta es el salto. Ver `docs/adr/0012` para por que no Dapr todavia.
 *
 * ESTO NO ROMPE LA COREOGRAFIA. Que el productor haga una peticion HTTP no lo
 * convierte en orquestador: no espera respuesta de negocio, no sabe que hace el
 * otro con el evento, no cambia su comportamiento segun lo que le contesten y el
 * hecho ya esta guardado antes de que la peticion exista. La diferencia con la
 * llamada sincrona que esto sustituye es exactamente esa: alli el gateway
 * ordenaba «pon este inmueble en arrendado» y el exito de la peticion importaba;
 * aqui anuncia «se formalizo un contrato» y quien escuche vera que hace.
 *
 * QUIEN ESCUCHA SE CONFIGURA, no se descubre. Nada de service discovery
 * (CLAUDE.md, «Que no hacer»): la lista de suscriptores sale del entorno.
 *
 * VARIOS SUSCRIPTORES DE UN MISMO EVENTO. La fila se marca entregada cuando
 * TODOS aceptan. Si uno falla, el reintento vuelve a entregar a todos, incluidos
 * los que ya lo tenian. Es deliberado: llevar el estado de entrega por
 * suscriptor complica la tabla para resolver un problema que el consumidor ya
 * resuelve descartando repetidos, que es algo que tiene que hacer de todos modos.
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
  /**
   * Quien escucha un tipo. Funcion y no lista porque la configuracion vive en
   * el entorno: leerla en cada entrega es lo que permite que las pruebas
   * apunten a un doble sin reconstruir el publicador, igual que hace la costura.
   */
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

/** Diez segundos: mas que el cliente HTTP normal, porque el consumidor escribe. */
export const TIMEOUT_ENTREGA_MS = 10000;

const unir = (base: string, ruta: string): string => `${base.replace(/\/+$/, '')}${ruta}`;

/**
 * Construye la funcion de entrega que consume el publicador.
 *
 * Lanza si alguna entrega falla, con los nombres de los suscriptores que no la
 * aceptaron: el publicador lo guarda en `ultimo_error`, que es lo que se mira
 * cuando un evento acaba apartado.
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
      // Un evento sin suscriptores no es un fallo: el productor no sabe ni tiene
      // que saber quien escucha. Se marca entregado y se deja constancia, porque
      // la otra lectura posible —falta una variable de entorno— tambien es real.
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
