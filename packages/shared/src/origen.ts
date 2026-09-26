/**
 * IP del cliente firmada por el gateway en cada reenvío, para que el servicio de
 * destino la use al limitar la tasa. Sin firma válida, el servicio usa la IP de
 * su conexión. La audiencia `#origen` impide usar este token como uno de servicio.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { TOLERANCIA_RELOJ_SEGUNDOS } from './servicio';

/** Nombre de la cabecera, en minusculas como la entrega Node. */
export const CABECERA_ORIGEN_CLIENTE = 'x-origen-cliente';

/** Lo que dura una firma de origen. Solo tiene que sobrevivir a un reenvio. */
export const VIGENCIA_ORIGEN_SEGUNDOS = 30;

/** Audiencia de un token de origen: nunca coincide con la de un token de servicio. */
export const audienciaDeOrigen = (destinatario: string): string => `${destinatario}#origen`;

export interface OpcionesFirmaOrigen {
  /** La IP del cliente, tal como la resolvio el gateway. */
  ip: string;
  emisor: string;
  destinatario: string;
  secreto: string | undefined;
}

/** Firma la IP del cliente con un `jti` nuevo. Lanza si no hay secreto. */
export function firmarOrigenCliente(opciones: OpcionesFirmaOrigen): string {
  if (!opciones.secreto) {
    throw new Error('Falta SERVICIO_JWT_SECRET: no se puede firmar el origen del cliente.');
  }

  return jwt.sign({ ip: opciones.ip }, opciones.secreto, {
    issuer: opciones.emisor,
    audience: audienciaDeOrigen(opciones.destinatario),
    expiresIn: VIGENCIA_ORIGEN_SEGUNDOS,
    jwtid: crypto.randomUUID(),
  });
}

export interface OpcionesVerificacionOrigen {
  /** Nombre de ESTE servicio. */
  destinatario: string;
  secreto: string | undefined;
}

/**
 * La IP firmada, o `null` si la cabecera falta, no es valida o no es para este
 * servicio. Quien la use tiene que caer en la IP de la conexion cuando es `null`.
 */
export function verificarOrigenCliente(
  valor: string | string[] | undefined,
  opciones: OpcionesVerificacionOrigen,
): string | null {
  if (typeof valor !== 'string' || valor === '' || !opciones.secreto) {
    return null;
  }

  try {
    const claims = jwt.verify(valor, opciones.secreto, {
      audience: audienciaDeOrigen(opciones.destinatario),
      clockTolerance: TOLERANCIA_RELOJ_SEGUNDOS,
    }) as jwt.JwtPayload;

    const ip = claims['ip'];
    return typeof ip === 'string' && ip !== '' ? ip : null;
  } catch {
    return null;
  }
}
