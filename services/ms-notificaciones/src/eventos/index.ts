/**
 * MS-Notificaciones como CONSUMIDOR del bus. Es lo unico que este servicio es.
 *
 * ── LO QUE EL PASO 7 CAMBIA, Y POR QUE ERA NECESARIO ────────────────────────
 *
 * Hasta aqui habia dos servicios de dominio abriendo conexiones SMTP:
 * ms-identidad, para el enlace de recuperacion (`docs/adr/0010`), y ms-financiero,
 * para los cuatro avisos del motor (`docs/adr/0018`). Los dos lo declaraban
 * provisional en el propio codigo y los dos apuntaban al mismo sitio: el paso 7.
 *
 * Ahora los dos PUBLICAN y este servicio decide a quien avisar y por que canal.
 * Coreografia, no orquestacion: ms-identidad no llama a nadie al emitir un token,
 * y el motor no sabe que existe este servicio.
 *
 * ── LA IDEMPOTENCIA IMPORTA AQUI MAS QUE EN NINGUN OTRO CONSUMIDOR ──────────
 *
 * Es la tercera vuelta de una escalada que el proyecto lleva anotada desde el paso
 * 4. `database/inmuebles/003` decia que poner un inmueble en `arrendado` dos veces
 * no hace daño «hoy»; `database/financiero/003` decia que insertar una cuenta de
 * cobro dos veces si, porque factura el mismo mes dos veces. Este es el peor de los
 * tres: un correo lo lee una persona y no hay `UPDATE` que lo recoja.
 *
 * Y no es una posibilidad remota. `ContratoFormalizado` tiene tres suscriptores
 * desde este paso, y la fila de la tabla de salida se marca entregada cuando
 * aceptan TODOS: si ms-inmuebles esta caido, este servicio recibe el evento otra
 * vez. Con entrega al-menos-una-vez, la reentrega es una certeza.
 *
 * ── PERO LA IDEMPOTENCIA SOLA NO BASTA, Y ESO ES LO IMPORTANTE DE AQUI ──────
 *
 * `crearConsumidor` mete la marca del evento y el efecto del manejador en una
 * transaccion. Eso funciona cuando el efecto es una fila. Un `sendMail` no lo es:
 * enviar dentro de la transaccion y que esta falle manda un correo que nadie
 * registro, y marcar el evento y enviar despues pierde el aviso si el envio falla.
 *
 * Asi que NINGUN MANEJADOR DE ESTE ARCHIVO ENVIA NADA. Cada uno resuelve el
 * destinatario, redacta el mensaje y lo deja como fila `pendiente` en
 * `notificaciones.envios`, dentro de la transaccion del consumidor. El `sendMail`
 * lo hace `services/enviador.ts`, que es otro barrido. Ver la cabecera de
 * `models/Envio.ts`.
 *
 * ── EL DESTINATARIO SE PREGUNTA, NO SE LEE DEL SOBRE ───────────────────────
 *
 * Ningun evento lleva una direccion de correo. Llevan `id_usuario`, y aqui se
 * pregunta a ms-identidad. Si no responde, el manejador LANZA: la transaccion se
 * va entera —incluida la marca del `id_evento`— el consumidor devuelve 500 y el
 * productor reintenta el evento con su espera creciente. El aviso no se pierde.
 * Ver la cabecera de `clientes/identidad.ts`.
 */

import crypto from 'crypto';
import {
  TIPO_CONTRASENA_TEMPORAL_EMITIDA,
  TIPO_CUENTA_COBRO_EN_MORA,
  TIPO_CUENTA_COBRO_GENERADA,
  TIPO_CUENTA_COBRO_POR_VENCER,
  TIPO_RECUPERACION_SOLICITADA,
  type Consumidor,
  type ContextoManejo,
  type ContrasenaTemporalEmitida,
  type CuentaCobroEnMora,
  type CuentaCobroGenerada,
  type CuentaCobroPorVencer,
  type Manejador,
  type RecuperacionSolicitada,
  comoConexion,
  crearConsumidor,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';
import { destinatariosDe, type Destinatario } from '../clientes/identidad';
import { Envio } from '../models/Envio';
import { CANAL_EMAIL, ENVIO_PENDIENTE } from '../models/constantes';
import * as plantillas from '../plantillas';
import type { Mensaje } from '../plantillas';
import { esUuid } from '../models/uuid';

/** La bitacora de este consumidor. Ver `database/notificaciones/001`. */
export const TABLA_PROCESADOS = `${ESQUEMA}.eventos_procesados`;

/** Un correo por redactar: a quien y con que. */
interface PorRedactar {
  destinatario: Destinatario;
  mensaje: Mensaje;
}

/**
 * Escribe los envios en la transaccion del consumidor.
 *
 * `bulkCreate` y no un `create` por fila: los dos avisos de una mora son un solo
 * hecho y tienen que quedar o no quedar juntos. Con dos INSERT sueltos en la misma
 * transaccion la atomicidad seria la misma, pero esto dice mejor lo que se quiere.
 *
 * Si no hay a quien avisar, se registra ALTO y no se escribe nada. No se lanza: un
 * usuario sin correo no se arregla reintentando, y diez intentos acabarian
 * apartando el evento del emisor por un dato que es de ms-identidad. Pero tampoco
 * se calla, porque «este aviso no llego a nadie» es exactamente lo que hay que
 * poder mirar cuando alguien pregunta por un correo que no recibio.
 */
const redactar = async (
  { sobre, transaccion }: ContextoManejo,
  porRedactar: PorRedactar[],
): Promise<void> => {
  if (porRedactar.length === 0) {
    console.warn(
      `⚠️  ms-notificaciones: ${sobre.tipo} ${sobre.id_evento} no avisó a NADIE — ` +
        'ninguno de sus destinatarios tiene correo resuelto en ms-identidad.',
    );
    return;
  }

  await Envio.bulkCreate(
    porRedactar.map(({ destinatario, mensaje }) => ({
      id_envio: crypto.randomUUID(),
      id_evento: sobre.id_evento,
      tipo_evento: sobre.tipo,
      id_usuario: destinatario.id_usuario,
      destinatario: destinatario.email,
      canal: CANAL_EMAIL,
      asunto: mensaje.asunto,
      cuerpo: mensaje.cuerpoHtml,
      estado: ENVIO_PENDIENTE,
    })),
    { transaction: transaccion as never },
  );

  console.log(
    `✉️  ms-notificaciones: ${sobre.tipo} ${sobre.id_evento} → ${porRedactar.length} ` +
      `envío(s) en cola para ${porRedactar.map((p) => p.destinatario.email).join(', ')}`,
  );
};

/**
 * Comprueba que la carga trae un identificador de usuario usable.
 *
 * CONFIANZA CERO (regla dura 7): que lo entregue otro servicio con credencial
 * valida no hace confiable lo que hay dentro del sobre. Una carga sin destinatario
 * LANZA a proposito, igual que en ms-financiero: es un error de programacion del
 * emisor, y el mecanismo ya sabe que hacer con un evento que falla siempre — lo
 * aparta tras diez intentos y lo deja a la vista. Tragarselo dejaria a alguien sin
 * su aviso y sin rastro de por que.
 */
const exigirUuid = (valor: unknown, campo: string, tipo: string): string => {
  if (!esUuid(valor)) {
    throw new Error(`${tipo} con ${campo} inválido: ${JSON.stringify(valor)}`);
  }
  return valor;
};

/** Igual, para un texto que la plantilla va a imprimir. */
const exigirTexto = (valor: unknown, campo: string, tipo: string): string => {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new Error(`${tipo} con ${campo} inválido: ${JSON.stringify(valor)}`);
  }
  return valor;
};

/**
 * Un manejador por tipo. Cinco, y los cinco con la misma forma:
 * validar la carga, resolver destinatarios, redactar.
 *
 * Los tipos que no estan aqui —`ContratoFormalizado`, `ContratoFinalizado`— llegan
 * igualmente si alguien suscribe este servicio a ellos, y el consumidor los ignora
 * con un 200. Es lo correcto en una coreografia: un tipo sin manejador significa
 * que la suscripcion sobra, no que la entrega haya fallado.
 */
export const manejadores: Record<string, Manejador> = {
  /**
   * Recuperacion de contrasena.
   *
   * El `token` se valida pero NO se registra en ningun log, nunca: es la credencial
   * que permite restablecer una contrasena. Por la misma razon, el mensaje de error
   * de una carga invalida no lo incluye — se comprueba el campo y se nombra, no se
   * imprime.
   */
  [TIPO_RECUPERACION_SOLICITADA]: async (payload, contexto) => {
    const carga = payload as Partial<RecuperacionSolicitada>;
    const tipo = TIPO_RECUPERACION_SOLICITADA;

    const idUsuario = exigirUuid(carga?.id_usuario, 'id_usuario', tipo);

    if (typeof carga.token !== 'string' || carga.token.length < 16) {
      // Sin el token no hay enlace que mandar, y el correo seria un aviso vacio.
      throw new Error(`${tipo} sin token utilizable para el usuario ${idUsuario}`);
    }
    exigirTexto(carga.expira_en, 'expira_en', tipo);

    const destinatarios = await destinatariosDe([idUsuario]);
    const destinatario = destinatarios.get(idUsuario);

    await redactar(
      contexto,
      destinatario
        ? [
            {
              destinatario,
              mensaje: plantillas.recuperacionSolicitada(
                carga as RecuperacionSolicitada,
                destinatario,
              ),
            },
          ]
        : [],
    );
  },

  /** Alta o reemision de la contrasena temporal. El sobre NO lleva la contrasena. */
  [TIPO_CONTRASENA_TEMPORAL_EMITIDA]: async (payload, contexto) => {
    const carga = payload as Partial<ContrasenaTemporalEmitida>;
    const tipo = TIPO_CONTRASENA_TEMPORAL_EMITIDA;

    const idUsuario = exigirUuid(carga?.id_usuario, 'id_usuario', tipo);

    if (carga.motivo !== 'ALTA' && carga.motivo !== 'REEMISION') {
      throw new Error(`${tipo} con motivo inválido: ${JSON.stringify(carga.motivo)}`);
    }

    const destinatarios = await destinatariosDe([idUsuario]);
    const destinatario = destinatarios.get(idUsuario);

    await redactar(
      contexto,
      destinatario
        ? [
            {
              destinatario,
              mensaje: plantillas.contrasenaTemporalEmitida(
                carga as ContrasenaTemporalEmitida,
                destinatario,
              ),
            },
          ]
        : [],
    );
  },

  /** Recibo generado. Un solo destinatario: a quien se le factura. */
  [TIPO_CUENTA_COBRO_GENERADA]: async (payload, contexto) => {
    const carga = payload as Partial<CuentaCobroGenerada>;
    const tipo = TIPO_CUENTA_COBRO_GENERADA;

    exigirUuid(carga?.id_cuenta_cobro, 'id_cuenta_cobro', tipo);
    const idInquilino = exigirUuid(carga?.id_inquilino, 'id_inquilino', tipo);
    exigirTexto(carga.inicio, 'inicio', tipo);
    exigirTexto(carga.fin, 'fin', tipo);

    const destinatarios = await destinatariosDe([idInquilino]);
    const destinatario = destinatarios.get(idInquilino);

    await redactar(
      contexto,
      destinatario
        ? [
            {
              destinatario,
              mensaje: plantillas.cuentaCobroGenerada(carga as CuentaCobroGenerada, destinatario),
            },
          ]
        : [],
    );
  },

  /**
   * Vencimiento proximo. DOS destinatarios, con plantillas distintas.
   *
   * Que el mismo hecho produzca dos correos con textos distintos es la razon de que
   * el evento lleve los dos identificadores y no una lista de correos: decidir a
   * quien se avisa y como se le habla es de este servicio, no del emisor.
   *
   * Si solo se resuelve uno de los dos, sale ese. Un aviso a medias es mejor que
   * ninguno, y el que falta queda registrado por `redactar` solo si faltan los dos.
   */
  [TIPO_CUENTA_COBRO_POR_VENCER]: async (payload, contexto) => {
    const carga = payload as Partial<CuentaCobroPorVencer>;
    const tipo = TIPO_CUENTA_COBRO_POR_VENCER;

    exigirUuid(carga?.id_cuenta_cobro, 'id_cuenta_cobro', tipo);
    const idInquilino = exigirUuid(carga?.id_inquilino, 'id_inquilino', tipo);
    const idPropietario = exigirUuid(carga?.id_propietario, 'id_propietario', tipo);
    exigirTexto(carga.entra_en_mora_el, 'entra_en_mora_el', tipo);

    const destinatarios = await destinatariosDe([idInquilino, idPropietario]);
    const completa = carga as CuentaCobroPorVencer;
    const lista: PorRedactar[] = [];

    const inquilino = destinatarios.get(idInquilino);
    if (inquilino) {
      lista.push({
        destinatario: inquilino,
        mensaje: plantillas.porVencerInquilino(completa, inquilino),
      });
    }

    const propietario = destinatarios.get(idPropietario);
    if (propietario) {
      lista.push({
        destinatario: propietario,
        mensaje: plantillas.porVencerPropietario(completa, propietario),
      });
    }

    await redactar(contexto, lista);
  },

  /** Mora. Mismo reparto que el anterior: un evento, dos destinatarios. */
  [TIPO_CUENTA_COBRO_EN_MORA]: async (payload, contexto) => {
    const carga = payload as Partial<CuentaCobroEnMora>;
    const tipo = TIPO_CUENTA_COBRO_EN_MORA;

    exigirUuid(carga?.id_cuenta_cobro, 'id_cuenta_cobro', tipo);
    const idInquilino = exigirUuid(carga?.id_inquilino, 'id_inquilino', tipo);
    const idPropietario = exigirUuid(carga?.id_propietario, 'id_propietario', tipo);

    const destinatarios = await destinatariosDe([idInquilino, idPropietario]);
    const completa = carga as CuentaCobroEnMora;
    const lista: PorRedactar[] = [];

    const inquilino = destinatarios.get(idInquilino);
    if (inquilino) {
      lista.push({
        destinatario: inquilino,
        mensaje: plantillas.enMoraInquilino(completa, inquilino),
      });
    }

    const propietario = destinatarios.get(idPropietario);
    if (propietario) {
      lista.push({
        destinatario: propietario,
        mensaje: plantillas.enMoraPropietario(completa, propietario),
      });
    }

    await redactar(contexto, lista);
  },
};

/**
 * El consumidor del servicio.
 *
 * `crearConsumidor` es quien pone la idempotencia: anota el `id_evento` en
 * `notificaciones.eventos_procesados` y aplica el manejador en la MISMA
 * transaccion, asi que una segunda entrega no redacta nada. Este archivo solo dice
 * que significa cada evento aqui.
 */
export const consumidor: Consumidor = crearConsumidor({
  conexion: comoConexion(sequelize),
  tabla: TABLA_PROCESADOS,
  manejadores,
});
