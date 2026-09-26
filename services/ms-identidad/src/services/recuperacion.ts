/**
 * Tokens de recuperación de contraseña: de un solo uso, de vida corta, guardados
 * como SHA-256. Pedir uno nuevo invalida los anteriores.
 */

import crypto from 'crypto';
import { Op } from 'sequelize';

import { TokenRecuperacion } from '../models/TokenRecuperacion';

/** Vigencia del enlace. */
export const VIGENCIA_MINUTOS = 30;

/** 32 bytes de entropia, en hexadecimal para que quepa en una URL sin escapar. */
const BYTES_TOKEN = 32;

/** Hash con el que se guarda y se busca el token. */
export const hashDeToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

/** Lo que se emite: el secreto y cuando deja de valer. */
export interface TokenEmitido {
  /** El token en claro. */
  token: string;
  /** Cuándo caduca. */
  expiraEn: Date;
}

/**
 * Emite un token para un usuario e invalida los pendientes. Debe correr en la
 * misma transacción que anota `RecuperacionSolicitada`.
 */
export const emitirTokenDeRecuperacion = async (
  idUsuario: string,
  transaccion?: unknown,
): Promise<TokenEmitido> => {
  const opciones = { transaction: transaccion as never };

  // Los pendientes se marcan como usados.
  await TokenRecuperacion.update(
    { usado_en: new Date() },
    { where: { id_usuario: idUsuario, usado_en: null }, ...opciones },
  );

  const token = crypto.randomBytes(BYTES_TOKEN).toString('hex');
  const expiraEn = new Date(Date.now() + VIGENCIA_MINUTOS * 60 * 1000);

  await TokenRecuperacion.create(
    {
      hash_token: hashDeToken(token),
      id_usuario: idUsuario,
      expira_en: expiraEn,
    },
    opciones,
  );

  return { token, expiraEn };
};

/** Busca un token vigente y sin usar; `null` si no existe, venció o ya se usó. */
export const buscarTokenVigente = async (token: string): Promise<TokenRecuperacion | null> => {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  return TokenRecuperacion.findOne({
    where: {
      hash_token: hashDeToken(token),
      usado_en: null,
      expira_en: { [Op.gt]: new Date() },
    },
  });
};

/** Marca el token como usado. Irreversible: es lo que lo hace de un solo uso. */
export const marcarUsado = async (registro: TokenRecuperacion): Promise<void> => {
  await registro.update({ usado_en: new Date() });
};
