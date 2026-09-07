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
 *
 * Y uno mas, que el Capitulo 2 no contempla todavia:
 *
 *   debe_cambiar  true mientras el usuario no haya elegido su contrasena
 *
 * Viaja en el token para que el gateway pueda bloquear la API sin preguntarle a
 * este servicio en cada peticion, igual que hace con los roles. Ver
 * docs/adr/0007.
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

/**
 * Firma un token para un usuario ya autenticado.
 *
 * `noAntesDe` fija el `iat` en lugar de dejar que lo ponga el reloj. Lo usa el
 * cambio de contrasena: acaba de dejar una marca que invalida todo token
 * anterior, y sin anclar el `iat` a esa misma marca el token que emite a
 * continuacion se invalidaria a si mismo.
 */
export const emitirToken = (
  usuario: Usuario,
  roles: string[],
  opciones: { noAntesDe?: Date } = {},
): TokenEmitido => {
  const jti = crypto.randomUUID();
  const iat = opciones.noAntesDe
    ? Math.ceil(opciones.noAntesDe.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

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

/**
 * Anota un `jti` en la lista de revocados hasta su expiracion natural.
 *
 * Idempotente: cerrar sesion dos veces con el mismo token no es un error.
 */
export const revocarToken = async (jti: string, expiraEn: Date): Promise<void> => {
  await TokenRevocado.upsert({ jti, expira_en: expiraEn });
};

/**
 * Marca de cambio de contrasena, redondeada HACIA ARRIBA al segundo.
 *
 * El redondeo no es cosmetico, y la direccion importa. El `iat` de un JWT viene
 * en segundos enteros, asi que no se puede distinguir un token emitido 100 ms
 * antes del cambio de uno emitido 100 ms despues. Hay que elegir a quien
 * favorece el empate.
 *
 * Se redondea hacia arriba para que el empate lo pierda el token viejo: si
 * alguien restablece su contrasena porque sospecha que hay otra sesion abierta,
 * una sesion que sobreviva un segundo mas es peor que ninguna otra cosa que
 * pueda pasar aqui.
 *
 * El token que se emite JUSTO DESPUES no se invalida a si mismo porque no se
 * deja al azar: `emitirToken` lo ancla a esta misma marca con `noAntesDe`.
 */
export const marcaDeCambio = (): Date => new Date(Math.ceil(Date.now() / 1000) * 1000);

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
 * Este token dejo de valer, por el motivo que sea?
 *
 * Dos motivos, y hacen falta los dos:
 *
 * - Su `jti` esta revocado: alguien cerro esa sesion concreta.
 * - Se emitio ANTES de que el usuario cambiara su contrasena: entonces caen
 *   todas sus sesiones de golpe. Es lo que hace util restablecer una contrasena
 *   cuando no se sabe cuantas sesiones ajenas hay abiertas.
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

/**
 * Sesiones invalidadas en bloque que todavia pueden afectar a algun token.
 *
 * Solo las de la ultima hora: un token dura 3600 segundos, asi que una marca mas
 * antigua no puede invalidar nada que siga vivo. El mismo criterio que mantiene
 * corta la lista de revocados.
 */
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
