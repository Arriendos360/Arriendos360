/**
 * Emision, verificacion y revocacion de tokens.
 *
 * Concentra todo lo que el Capitulo 2 fija sobre el JWT. Los claims:
 *
 *   sub    UUID del usuario
 *   email  correo del usuario
 *   roles  arreglo de strings en mayusculas
 *   jti    UUID unico del token, necesario para poder revocarlo
 *   exp    expiracion, 3600 segundos
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';

import { PRECEDENCIA_ROLES, TIPO_TOKEN, VIGENCIA_TOKEN_SEGUNDOS } from '../models/constantes';
import { TokenRevocado } from '../models/TokenRevocado';
import { Usuario } from '../models/Usuario';

export interface TokenEmitido {
  token: string;
  jti: string;
  tipo_token: string;
  /** Fecha ISO absoluta, que es lo que declara la respuesta del login. */
  expiracion: string;
  expira_en: Date;
}

/**
 * Elige el `rol` singular que la respuesta del login expone al frontend.
 *
 * No contradice al arreglo `roles` de los claims: son dos audiencias. Los claims
 * le hablan al gateway y a los servicios, que necesitan la lista completa para
 * autorizar; la respuesta le habla a la SPA, que solo necesita saber que barra
 * lateral pintar al entrar.
 */
export const rolPrincipal = (roles: string[]): string | null =>
  PRECEDENCIA_ROLES.find((candidato) => roles.includes(candidato)) ?? roles[0] ?? null;

/** Firma un token para un usuario ya autenticado. */
export const emitirToken = (usuario: Usuario, roles: string[]): TokenEmitido => {
  const jti = crypto.randomUUID();

  const token = jwt.sign(
    { sub: usuario.id_usuario, email: usuario.email, roles, jti },
    process.env['JWT_SECRET'] as jwt.Secret,
    { expiresIn: VIGENCIA_TOKEN_SEGUNDOS },
  );

  const expiraEn = new Date(Date.now() + VIGENCIA_TOKEN_SEGUNDOS * 1000);

  return {
    token,
    jti,
    tipo_token: TIPO_TOKEN,
    expiracion: expiraEn.toISOString(),
    expira_en: expiraEn,
  };
};

/**
 * Anota un `jti` en la lista de revocados hasta su expiracion natural.
 *
 * Idempotente: cerrar sesion dos veces con el mismo token no es un error.
 */
export const revocarToken = async (jti: string, expiraEn: Date): Promise<void> => {
  await TokenRevocado.upsert({ jti, expira_en: expiraEn });
};

/**
 * Esta revocado este `jti`?
 *
 * El filtro por `expira_en > NOW()` es lo que permite prescindir del barrido
 * programado: una fila vencida sigue en la tabla pero deja de tener efecto,
 * porque el token que representa ya no pasaria la verificacion de firma.
 */
export const estaRevocado = async (jti: string): Promise<boolean> => {
  if (!jti) {
    return false;
  }

  const revocado = await TokenRevocado.findOne({
    where: { jti, expira_en: { [Op.gt]: new Date() } },
  });

  return revocado !== null;
};

/**
 * Los `jti` revocados que todavia estan vigentes.
 *
 * Es lo que el gateway consulta periodicamente para mantener su copia en
 * memoria, en vez de preguntar por cada peticion. El filtro por `expira_en` hace
 * que la lista se mantenga corta sola: con tokens de una hora, nunca crece mas
 * alla de los cierres de sesion de la ultima hora.
 */
export const revocadosVigentes = async (): Promise<Array<{ jti: string; expira_en: Date }>> => {
  const filas = await TokenRevocado.findAll({
    where: { expira_en: { [Op.gt]: new Date() } },
    order: [['expira_en', 'ASC']],
  });

  return filas.map((fila) => ({ jti: fila.jti, expira_en: fila.expira_en }));
};

/** Convierte el `exp` del token (segundos desde epoch) en una fecha. */
export const fechaDeExpiracion = (claims: { exp?: number } | undefined): Date =>
  claims?.exp ? new Date(claims.exp * 1000) : new Date();
