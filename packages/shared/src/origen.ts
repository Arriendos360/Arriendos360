/**
 * La IP del cliente, firmada por el gateway para el servicio que la necesita.
 *
 * ── POR QUE HACE FALTA ─────────────────────────────────────────────────────
 *
 * Detras del gateway, un servicio ve como origen de la conexion al gateway, no a
 * la persona. Y `X-Forwarded-For` no sirve de sustituto: el gateway copia las
 * cabeceras entrantes, asi que cualquiera podria mandar la suya y elegir desde que
 * IP dice venir. ms-identidad limita intentos por IP (`docs/adr/0020`), y un limite
 * por IP que el cliente elige no limita nada.
 *
 * Asi que el gateway, que es quien ve la conexion real, firma la IP con
 * `SERVICIO_JWT_SECRET` en cada peticion que reenvia. El servicio la usa SOLO si la
 * firma es valida; si no, usa la IP real de su conexion. Quien llame directo al
 * puerto del servicio queda limitado por su propia IP: no hay forma de saltarse el
 * limite inventandose la cabecera. Es la regla dura 7 aplicada a un dato.
 *
 * ── POR QUE NO ES UN TOKEN DE SERVICIO CON UN CAMPO MAS ────────────────────
 *
 * Porque entonces SERIA un token de servicio: mismo secreto, mismo emisor, misma
 * audiencia. Cualquier cosa que viera pasar esta cabecera tendria una credencial
 * valida para `/interno` del servicio de destino. La audiencia lleva el sufijo
 * `#origen`, y `verificarTokenDeServicio` exige la audiencia exacta: ninguno de los
 * dos tokens vale como el otro.
 *
 * ── Y CADA TOKEN ES UNICO ──────────────────────────────────────────────────
 *
 * Lleva `jti` aleatorio y vigencia corta, y el gateway lo firma en CADA reenvio. Un
 * token reutilizado entre peticiones contaria a todos los clientes bajo la IP del
 * primero; hay una prueba en el gateway que lo impide.
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

/** Firma la IP del cliente. LANZA si no hay secreto. */
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
