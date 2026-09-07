/**
 * Adaptador Express sobre la verificacion de token de `packages/shared`.
 *
 * CONFIANZA CERO (regla dura 7): este servicio verifica el token por su cuenta
 * aunque la peticion venga del gateway y el gateway ya lo haya verificado. No
 * es redundancia: el dia que alguien alcance la red interna sin pasar por el
 * gateway, esta es la unica comprobacion que queda en pie.
 *
 * La logica de verificacion no se reimplementa: vive en `packages/shared` y es
 * la misma que usa el gateway. Aqui solo esta lo que es propio de Express.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  MENSAJE_ROL_INSUFICIENTE,
  ROL_PROPIETARIO,
  crearError,
  esPropietario as claimsSonDePropietario,
  verificarTokenConRevocacion,
} from 'arriendos360-shared';

import { estaRevocado } from '../services/tokenService';

export const verificarToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  const resultado = await verificarTokenConRevocacion(
    { authorization: req.headers['authorization'] },
    process.env['JWT_SECRET'],
    estaRevocado,
  );

  if (!resultado.valido) {
    return res.status(resultado.estado).json(resultado.error);
  }

  req.usuario = resultado.claims;
  return next();
};

/**
 * Exige el rol PROPIETARIO.
 *
 * El gateway ya aplica su matriz RBAC, pero eso es la Capa 2 y esto es la Capa
 * 3: las dos tienen que sostenerse solas.
 */
export const esPropietario = (req: Request, res: Response, next: NextFunction): Response | void => {
  if (claimsSonDePropietario(req.usuario)) {
    return next();
  }

  return res.status(403).json(crearError(MENSAJE_ROL_INSUFICIENTE));
};

export { ROL_PROPIETARIO };
