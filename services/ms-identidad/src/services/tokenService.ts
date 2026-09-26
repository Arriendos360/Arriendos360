/**
 * Emisión, verificación y revocación de tokens de usuario.
 *
 * Claims: `sub`, `email`, `roles`, `jti`, `exp` (3600 s) y `debe_cambiar`, que
 * es `true` mientras el usuario no haya elegido su contraseña.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';

import type { ClaimsUsuario } from 'arriendos360-shared';

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

/** El `rol` singular que la respuesta del login expone a la SPA. */
export const rolPrincipal = (roles: string[]): string | null =>
  PRECEDENCIA_ROLES.find((candidato) => roles.includes(candidato)) ?? roles[0] ?? null;

/**
 * Firma un token para un usuario autenticado. Su `iat` nunca es anterior al
 * último cambio de contraseña (ni a `noAntesDe`), para que no nazca invalidado.
 */
export const emitirToken = (
  usuario: Usuario,
  roles: string[],
  opciones: { noAntesDe?: Date } = {},
): TokenEmitido => {
  const jti = crypto.randomUUID();

  const enSegundosHaciaArriba = (fecha: Date): number => Math.ceil(fecha.getTime() / 1000);

  const iat = Math.max(
    Math.floor(Date.now() / 1000),
    opciones.noAntesDe ? enSegundosHaciaArriba(opciones.noAntesDe) : 0,
    usuario.contrasena_cambiada_en ? enSegundosHaciaArriba(usuario.contrasena_cambiada_en) : 0,
  );

  const token = jwt.sign(
    {
      sub: usuario.id_usuario,
      email: usuario.email,
      roles,
      jti,
      debe_cambiar: usuario.debe_cambiar_contrasena === true,
      iat,
    },
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

/** Anota un `jti` en la lista de revocados hasta su expiración natural. Idempotente. */
export const revocarToken = async (jti: string, expiraEn: Date): Promise<void> => {
  await TokenRevocado.upsert({ jti, expira_en: expiraEn });
};

/**
 * Marca de cambio de contraseña, redondeada hacia arriba al segundo: en un empate
 * con el `iat`, pierde el token viejo.
 */
export const marcaDeCambio = (): Date => new Date(Math.ceil(Date.now() / 1000) * 1000);

/** ¿Está revocado este `jti`? Sólo cuentan las filas no vencidas. */
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
 * ¿Dejó de valer el token? Si su `jti` está revocado o se emitió antes del último
 * cambio de contraseña del usuario.
 */
export const tokenInvalidado = async (claims: ClaimsUsuario): Promise<boolean> => {
  if (await estaRevocado(claims.jti)) {
    return true;
  }

  if (claims.iat === undefined) {
    return false;
  }

  const usuario = await Usuario.findByPk(claims.sub, {
    attributes: ['contrasena_cambiada_en'],
  });

  const marca = usuario?.contrasena_cambiada_en;
  return marca !== null && marca !== undefined && claims.iat * 1000 < marca.getTime();
};

/** Cambios de contraseña de la última hora, que aún pueden invalidar tokens vivos. */
export const sesionesInvalidadas = async (): Promise<Array<{ sub: string; desde: string }>> => {
  const desde = new Date(Date.now() - VIGENCIA_TOKEN_SEGUNDOS * 1000);

  const usuarios = await Usuario.findAll({
    where: { contrasena_cambiada_en: { [Op.gt]: desde } },
    attributes: ['id_usuario', 'contrasena_cambiada_en'],
  });

  return usuarios.map((usuario) => ({
    sub: usuario.id_usuario,
    desde: (usuario.contrasena_cambiada_en as Date).toISOString(),
  }));
};

/** Los `jti` revocados que todavía no han vencido. */
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
