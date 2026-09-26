/**
 * Enviador: barre la bitácora de envíos, manda cada correo y lo marca.
 *
 * La fila pasa a `enviando` antes del `sendMail`. Una que quede en `enviando`
 * porque el proceso murió no se reintenta sola: podría duplicar un correo. Un
 * fallo conocido de `sendMail` sí vuelve a `pendiente` con espera creciente.
 */

import { Op } from 'sequelize';

import { Envio } from '../models/Envio';
import {
  ENVIO_APARTADO,
  ENVIO_ENVIADO,
  ENVIO_ENVIANDO,
  ENVIO_PENDIENTE,
} from '../models/constantes';
import { enviarCorreo as enviarPorSmtp } from '../config/mailer';
import { enteroOpcionalDeEntorno } from 'arriendos360-shared';

/** Intervalo entre barridos. */
export const INTERVALO_ENVIO_MS = 5000;
export const TAMANO_LOTE_POR_DEFECTO = 20;

/** Intentos antes de apartar un envío. */
export const MAX_INTENTOS_POR_DEFECTO = 5;
export const ESPERA_BASE_MS = 5000;
export const ESPERA_MAXIMA_MS = 300000;

/** Lo que el enviador hace con un mensaje. Inyectable para las pruebas. */
export type EnviarMensaje = (
  destinatario: string,
  asunto: string,
  html: string,
) => Promise<{ messageId: string; vistaPrevia?: string; simulado?: boolean }>;

export interface OpcionesEnviador {
  enviar?: EnviarMensaje;
  intervaloMs?: number;
  tamanoLote?: number;
  maxIntentos?: number;
  esperaBaseMs?: number;
  esperaMaximaMs?: number;
  registrar?: (mensaje: string) => void;
  /** Inyectable para que las pruebas no dependan del reloj. */
  ahora?: () => Date;
}

export interface ResultadoCicloEnvio {
  enviados: number;
  fallidos: number;
  apartados: number;
  /** Vistos pero no intentados: esperando su reintento, o tomados por otro. */
  aplazados: number;
}

export interface EstadoEnviador {
  intervaloMs: number;
  maxIntentos: number;
  ultimoCiclo: Date | null;
  enviadosEnTotal: number;
  apartadosEnTotal: number;
}

export interface Enviador {
  /** Un barrido. Expuesto para que las pruebas no dependan de temporizadores. */
  ciclo: () => Promise<ResultadoCicloEnvio>;
  iniciar: () => Promise<NodeJS.Timeout>;
  detener: () => void;
  estado: () => EstadoEnviador;
}

export function crearEnviador(opciones: OpcionesEnviador = {}): Enviador {
  const enviar = opciones.enviar ?? enviarPorSmtp;
  const intervaloMs = opciones.intervaloMs ?? INTERVALO_ENVIO_MS;
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE_POR_DEFECTO;
  const maxIntentos = opciones.maxIntentos ?? MAX_INTENTOS_POR_DEFECTO;
  const esperaBaseMs = opciones.esperaBaseMs ?? ESPERA_BASE_MS;
  const esperaMaximaMs = opciones.esperaMaximaMs ?? ESPERA_MAXIMA_MS;
  const registrar = opciones.registrar ?? ((mensaje: string) => console.error(mensaje));
  const ahora = opciones.ahora ?? (() => new Date());

  let temporizador: NodeJS.Timeout | null = null;
  let ultimoCiclo: Date | null = null;
  let enviadosEnTotal = 0;
  let apartadosEnTotal = 0;

  /** Espera exponencial con tope: 5s, 10s, 20s... hasta 5 min. */
  const esperaTras = (intentos: number): number =>
    Math.min(esperaBaseMs * 2 ** Math.max(0, intentos - 1), esperaMaximaMs);

  /**
   * Toma la fila: la pasa a `enviando` sólo si sigue `pendiente`. Si otro barrido
   * ya la tomó, devuelve `false`.
   */
  const tomar = async (idEnvio: string): Promise<boolean> => {
    const [afectadas] = await Envio.update(
      { estado: ENVIO_ENVIANDO },
      { where: { id_envio: idEnvio, estado: ENVIO_PENDIENTE } },
    );

    return afectadas === 1;
  };

  const ciclo = async (): Promise<ResultadoCicloEnvio> => {
    const resultado: ResultadoCicloEnvio = {
      enviados: 0,
      fallidos: 0,
      apartados: 0,
      aplazados: 0,
    };

    const momento = ahora();

    let filas: Envio[];
    try {
      filas = await Envio.findAll({
        where: {
          estado: ENVIO_PENDIENTE,
          proximo_intento_en: { [Op.lte]: momento },
        },
        order: [
          ['registrado_en', 'ASC'],
          ['id_envio', 'ASC'],
        ],
        limit: tamanoLote,
      });
    } catch (error) {
      registrar(
        `ms-notificaciones: no se pudo leer la bitácora de envíos: ${(error as Error).message}`,
      );
      return resultado;
    }

    for (const fila of filas) {
      if (!(await tomar(fila.id_envio))) {
        resultado.aplazados += 1;
        continue;
      }

      const intentos = fila.intentos + 1;

      try {
        // Nunca se manda un correo vacío.
        if (!fila.cuerpo) {
          throw new Error('El envío no tiene cuerpo: no se manda un correo vacío');
        }

        const { vistaPrevia, simulado } = await enviar(
          fila.destinatario,
          fila.asunto,
          fila.cuerpo,
        );

        // Marca y borra el cuerpo en una sola sentencia: no la partas, o el enlace
        // de recuperación podría quedar guardado.
        await Envio.update(
          {
            estado: ENVIO_ENVIADO,
            enviado_en: momento,
            intentos,
            ultimo_error: null,
            cuerpo: null,
          },
          { where: { id_envio: fila.id_envio } },
        );

        resultado.enviados += 1;
        enviadosEnTotal += 1;

        console.log(
          `📧 ms-notificaciones: ${fila.tipo_evento} ${simulado ? 'SIMULADO' : 'enviado'} a ` +
            `${fila.destinatario} — ${fila.asunto}` +
            `${vistaPrevia ? ` (vista previa: ${vistaPrevia})` : ''}`,
        );
      } catch (error) {
        const mensaje = (error as Error).message;

        if (intentos >= maxIntentos) {
          await Envio.update(
            { estado: ENVIO_APARTADO, intentos, ultimo_error: mensaje.slice(0, 1000) },
            { where: { id_envio: fila.id_envio } },
          );

          resultado.apartados += 1;
          apartadosEnTotal += 1;

          registrar(
            `⛔ ms-notificaciones: envío ${fila.id_envio} (${fila.tipo_evento} a ` +
              `${fila.destinatario}) APARTADO tras ${intentos} intentos: ${mensaje}. ` +
              'Deja de intentarse y queda en notificaciones.envios para revisión.',
          );
          continue;
        }

        // Se sabe que no salió: vuelve a la cola con espera creciente.
        await Envio.update(
          {
            estado: ENVIO_PENDIENTE,
            intentos,
            ultimo_error: mensaje.slice(0, 1000),
            proximo_intento_en: new Date(momento.getTime() + esperaTras(intentos)),
          },
          { where: { id_envio: fila.id_envio } },
        );

        resultado.fallidos += 1;

        registrar(
          `⚠️  ms-notificaciones: envío fallido de ${fila.tipo_evento} a ${fila.destinatario} ` +
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

  const estado = (): EstadoEnviador => ({
    intervaloMs,
    maxIntentos,
    ultimoCiclo,
    enviadosEnTotal,
    apartadosEnTotal,
  });

  return { ciclo, detener, estado, iniciar };
}

/** El enviador del proceso, sin arrancar: lo arranca `server.ts`. */
export const enviador: Enviador = crearEnviador({
  intervaloMs: enteroOpcionalDeEntorno('ENVIOS_INTERVALO_MS'),
});

/** Cuántos envíos hay en cada estado, para el log de arranque. */
export const contarEnvios = async (): Promise<{
  pendientes: number;
  enviados: number;
  enviando: number;
  apartados: number;
}> => {
  const [pendientes, enviados, enviando, apartados] = await Promise.all([
    Envio.count({ where: { estado: ENVIO_PENDIENTE } }),
    Envio.count({ where: { estado: ENVIO_ENVIADO } }),
    Envio.count({ where: { estado: ENVIO_ENVIANDO } }),
    Envio.count({ where: { estado: ENVIO_APARTADO } }),
  ]);

  return { pendientes, enviados, enviando, apartados };
};
