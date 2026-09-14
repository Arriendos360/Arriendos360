/**
 * El enviador: barre la bitacora de envios, manda y marca.
 *
 * ── ES EL PUBLICADOR DE LA TABLA DE SALIDA, UN PISO MAS ABAJO ───────────────
 *
 * Y la simetria es intencionada. El bus resolvio «guardar un hecho y anunciarlo no
 * caben en la misma operacion» con una tabla y un barrido; aqui el problema es el
 * mismo entre «procesar el evento» y «mandar el correo», porque un `sendMail` no se
 * deshace con un ROLLBACK. Misma forma, misma solucion: el manejador redacta la
 * fila dentro de su transaccion (`eventos/index.ts`) y esto la saca despues.
 *
 * Lo que se gana es lo de siempre en un outbox: el correo no se pierde si el
 * servidor SMTP esta caido —ya esta en disco— y el fallo queda anotado en vez de
 * perderse en un `console.error`, que es lo que hacian los dos mailers anteriores.
 *
 * ── PERO HAY UNA ASIMETRIA DELIBERADA: ANTE LA DUDA, NO SE REENVIA ──────────
 *
 * Esta es la unica decision de este archivo que no se copia del publicador, y es la
 * que mas importa.
 *
 * El publicador entrega y marca en dos pasos, y acepta que un corte entre ellos
 * provoque una segunda entrega: la entrega es al-menos-una-vez POR DISEÑO, porque
 * el consumidor descarta repetidos y el efecto duplicado nunca llega a producirse.
 * Ahi «ante la duda, reintentar» es gratis.
 *
 * Aqui no. El consumidor es una persona con un buzon, y no descarta nada. Asi que
 * el orden se invierte: la fila pasa a `enviando` ANTES del `sendMail`, y una fila
 * que se quede en `enviando` porque el proceso murio con el mensaje en vuelo NO SE
 * REINTENTA SOLA — queda a la vista para que alguien decida.
 *
 * El razonamiento: los dos estados posibles tras un corte son «salio y no se
 * anoto» y «no salio». No se distinguen desde aqui. Reintentar convierte el primero
 * en un correo duplicado, que nadie puede deshacer y que en el caso del enlace de
 * recuperacion significa un segundo enlace vivo en un buzon. No reintentar convierte
 * el segundo en un aviso que no salio — y que se ve en una consulta, y que se puede
 * reencolar a mano. De los dos daños, el reparable es el segundo.
 *
 * Un fallo CONOCIDO es otra cosa: si `sendMail` lanza, se sabe que no salio, asi
 * que la fila vuelve a `pendiente` con espera creciente y se reintenta con
 * normalidad. La duda solo existe cuando el proceso no llega a anotar nada.
 *
 * ── ESTE BARRIDO SI SOBREVIVE AL SCALE-TO-ZERO, AL CONTRARIO QUE EL MOTOR ───
 *
 * Y conviene no confundir los dos casos, porque `docs/adr/0018` deja el del motor
 * marcado como bloqueante para produccion. La diferencia es el disparador: el motor
 * necesita ejecutarse A UNA HORA —00:01, haya trafico o no— y un contenedor dormido
 * a esa hora simplemente no genera las cuentas del dia. Este barrido no tiene hora:
 * despierta cuando hay algo que mandar, y lo que hace que haya algo que mandar es
 * una peticion HTTP —`POST /interno/eventos`— que es justamente lo que levanta el
 * contenedor.
 *
 * El caso incomodo es el contrario: que el contenedor se duerma con filas
 * pendientes, porque el evento entro y el SMTP fallo. Eso se arregla solo en cuanto
 * llegue el evento siguiente, y `iniciar()` hace un primer barrido inmediato
 * justamente para eso. No es una garantia fuerte —un sistema sin eventos nuevos no
 * despierta— pero es un aviso retrasado, no uno perdido. Si algun dia hace falta la
 * garantia, la salida es la misma que la del motor: un `Job` de Container Apps.
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

/** Cinco segundos, el mismo intervalo que el publicador del bus. */
export const INTERVALO_ENVIO_MS = 5000;
export const TAMANO_LOTE_POR_DEFECTO = 20;

/**
 * Cinco intentos, no diez.
 *
 * El publicador usa diez (~13 min) porque entrega a un servicio que se reinicia en
 * segundos. Un servidor de correo que rechaza cinco veces con espera creciente
 * —unos 2,5 minutos— casi nunca esta «reiniciandose»: o la direccion es mala, o la
 * credencial no vale, o el proveedor esta limitando. Ninguna de las tres se arregla
 * insistiendo, y las tres piden que una persona lo vea.
 */
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
   * Toma la fila: la pone en `enviando` solo si sigue `pendiente`.
   *
   * El `where` sobre el estado es lo que hace que esto sea una TOMA y no un simple
   * cambio. Si otro ciclo —o otra replica— ya se la llevo, el UPDATE afecta a cero
   * filas y esta pasada la salta. Sin eso, dos barridos solapados mandarian el
   * mismo correo dos veces, que es exactamente lo que este servicio no puede hacer.
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
      // A diferencia del publicador, aqui NO hay claves de orden ni frenado: dos
      // correos a la misma persona no son ordenes contrarias, y retrasar un aviso
      // porque otro suyo fallo no arregla nada.
      if (!(await tomar(fila.id_envio))) {
        resultado.aplazados += 1;
        continue;
      }

      const intentos = fila.intentos + 1;

      try {
        // Una fila `pendiente` siempre tiene cuerpo: solo se borra al marcarla
        // enviada. Se comprueba ANTES de mandar y no despues, porque un correo en
        // blanco ya enviado no se puede retirar — y es peor que uno que no sale.
        if (!fila.cuerpo) {
          throw new Error('El envío no tiene cuerpo: no se manda un correo vacío');
        }

        const { vistaPrevia, simulado } = await enviar(
          fila.destinatario,
          fila.asunto,
          fila.cuerpo,
        );

        // UNA sola sentencia: marca, cuenta el intento, limpia el error anterior y
        // BORRA EL CUERPO. Que el borrado vaya aqui y no en una segunda llamada es
        // lo que impide que un corte entre las dos deje el enlace de recuperacion
        // guardado indefinidamente. Mismo criterio que `marcarEntregado()` en la
        // tabla de salida.
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

        // `simulado` se dice en el log y NO en la fila. La bitácora registra que el canal
        // aceptó el mensaje, que es lo que decide si hay que reintentarlo; si además
        // salió de la máquina depende de la configuración del despliegue, no del envío.
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

        // Fallo CONOCIDO: se sabe que no salio, asi que vuelve a la cola. La duda
        // —y con ella el «no se reenvia»— solo existe si el proceso muere antes de
        // llegar hasta aqui, y entonces la fila se queda en `enviando`.
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
    // Un primer barrido inmediato: si el proceso se cayo con envios pendientes,
    // salen ahora y no dentro de un intervalo. Mismo motivo que en el publicador, y
    // aqui ademas es lo que recupera un contenedor que se durmio con cola.
    await ciclo();

    temporizador = setInterval(() => {
      void ciclo();
    }, intervaloMs);

    // No debe mantener vivo el proceso, igual que la cache de invalidacion y el
    // publicador.
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

/**
 * El enviador del proceso.
 *
 * Creado al cargar el modulo pero SIN arrancar: `server.ts` lo pone en marcha
 * cuando el servidor arranca de verdad, y las pruebas llaman a `ciclo()` a mano. Un
 * temporizador corriendo durante una suite haria que los envios ocurrieran en
 * momentos que la prueba no controla, que es la forma mas facil de escribir una
 * prueba que falla un dia de cada veinte. Es la convencion de CLAUDE.md: nada de
 * temporizadores en las suites.
 */
export const enviador: Enviador = crearEnviador({
  intervaloMs: Number(process.env['ENVIOS_INTERVALO_MS']) || undefined,
});

/**
 * Cuenta lo que hay en la bitacora, para el log de arranque y el diagnostico.
 *
 * `enviando` y `apartado` se cuentan aparte porque son los dos estados que NADIE va
 * a resolver solo: el primero son los que se quedaron en el aire, el segundo los
 * que agotaron sus intentos. Que salgan en el arranque es lo que hace que un
 * problema de correo se vea sin ir a buscarlo.
 */
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
