/**
 * Tokens de recuperacion de contrasena.
 *
 * Un token de un solo uso, de vida corta, que llega por correo y permite elegir
 * una contrasena nueva sin conocer la anterior.
 *
 * TRES DECISIONES
 *
 * 1. **Se guarda el hash, no el token.** Igual que con las contrasenas: quien
 *    consiga leer la tabla no debe poder restablecer la clave de nadie. El token
 *    en claro existe una sola vez, en el correo que se envia.
 *
 *    Se usa SHA-256 y no bcrypt a proposito. Bcrypt es lento por diseño para
 *    resistir fuerza bruta sobre contrasenas que las personas eligen mal; aqui
 *    el secreto tiene 256 bits de entropia y no hay nada que adivinar. Ademas la
 *    busqueda al restablecer es POR el hash, y con bcrypt —que sala cada
 *    calculo— habria que recorrer la tabla comparando una a una.
 *
 * 2. **Un solo uso.** Un enlace ya usado no vuelve a servir aunque no haya
 *    vencido. Sin eso, quien tuviera acceso al buzon podria restablecer la
 *    contrasena tantas veces como quisiera durante media hora.
 *
 * 3. **Los anteriores se invalidan al pedir uno nuevo.** Pedir recuperacion dos
 *    veces deja valido solo el ultimo enlace, que es lo que la persona espera.
 */

import crypto from 'crypto';
import { Op } from 'sequelize';

import { TokenRecuperacion } from '../models/TokenRecuperacion';

/** Media hora. Suficiente para ir al correo y volver, corto para lo demas. */
export const VIGENCIA_MINUTOS = 30;

/** 32 bytes de entropia, en hexadecimal para que quepa en una URL sin escapar. */
const BYTES_TOKEN = 32;

/** Hash con el que se guarda y se busca. Ver la nota 1 de la cabecera. */
export const hashDeToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

/** Lo que se emite: el secreto y cuando deja de valer. */
export interface TokenEmitido {
  /** El token EN CLARO. Es la unica vez que existe fuera del correo. */
  token: string;
  /** Cuando caduca. Viaja en el evento para que el correo no prometa de mas. */
  expiraEn: Date;
}

/**
 * Emite un token para un usuario e invalida los que tuviera pendientes.
 *
 * ── RECIBE LA TRANSACCION, Y DESDE EL PASO 7 ES OBLIGATORIO QUE LA USE ─────
 *
 * Las tres escrituras que rodean a esto —invalidar los anteriores, crear el nuevo y
 * anotar `RecuperacionSolicitada` en la tabla de salida— tienen que quedar todas o
 * ninguna. Si el token se guardara y el evento no, habria un enlace vivo que nadie
 * recibio; si el evento se anotara y el token no, llegaria un correo con un enlace
 * inexistente. Las tres van al esquema `identidad`, asi que caben en una
 * transaccion y ninguno de los dos casos es posible.
 *
 * Antes del paso 7 no hacia falta, porque el correo salia dentro de la peticion y su
 * fallo no podia dejar nada a medias: no habia nada mas que escribir.
 *
 * ── DEVUELVE TAMBIEN LA CADUCIDAD ─────────────────────────────────────────
 *
 * Porque ahora hay que ponerla en el sobre. El consumidor NO la recalcula: los 30
 * minutos empiezan aqui, y si la entrega se retrasa, el correo tiene que decir la
 * hora de verdad en vez de prometer media hora que ya no existe.
 */
export const emitirTokenDeRecuperacion = async (
  idUsuario: string,
  transaccion?: unknown,
): Promise<TokenEmitido> => {
  const opciones = { transaction: transaccion as never };

  // Los pendientes se marcan como usados: pedir recuperacion otra vez deja
  // valido solo el ultimo enlace.
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

/**
 * Busca un token vigente y sin usar.
 *
 * Devuelve `null` si no existe, si vencio o si ya se uso. No distingue entre los
 * tres casos: a quien restablece le da igual el motivo, y a quien este probando
 * no se le regalan pistas.
 */
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
