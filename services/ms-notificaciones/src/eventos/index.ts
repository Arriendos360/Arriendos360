/**
 * MS-Notificaciones como consumidor del bus. Cada manejador valida la carga,
 * resuelve los destinatarios en ms-identidad y deja los correos como filas
 * `pendiente` en `notificaciones.envios`, dentro de la transacción del consumidor.
 * No envía nada: eso lo hace `services/enviador.ts`.
 *
 * Si ms-identidad no responde, el manejador lanza y el productor reintenta.
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

/** Bitácora de eventos procesados de este consumidor. */
export const TABLA_PROCESADOS = `${ESQUEMA}.eventos_procesados`;

/** Un correo por redactar: a quien y con que. */
interface PorRedactar {
  destinatario: Destinatario;
  mensaje: Mensaje;
}

/**
 * Escribe los envíos en la transacción del consumidor, todos juntos. Si no hay a
 * quién avisar, lo registra y no escribe nada.
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

/** Exige un UUID en la carga; lanza si no lo es, para que el evento acabe apartado. */
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

/** Un manejador por tipo: validar la carga, resolver destinatarios y redactar. */
export const manejadores: Record<string, Manejador> = {
  /** Recuperación de contraseña. El `token` nunca se escribe en un log. */
  [TIPO_RECUPERACION_SOLICITADA]: async (payload, contexto) => {
    const carga = payload as Partial<RecuperacionSolicitada>;
    const tipo = TIPO_RECUPERACION_SOLICITADA;

    const idUsuario = exigirUuid(carga?.id_usuario, 'id_usuario', tipo);

    if (typeof carga.token !== 'string' || carga.token.length < 16) {
      // Sin token no hay enlace que mandar.
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
   * Vencimiento próximo: un correo al inquilino y otro al propietario, con
   * plantillas distintas. Sale el de quien se pueda resolver.
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

/** El consumidor del servicio: descarta repetidos y aplica el manejador. */
export const consumidor: Consumidor = crearConsumidor({
  conexion: comoConexion(sequelize),
  tabla: TABLA_PROCESADOS,
  manejadores,
});
