/**
 * Verificación del token de usuario en el servicio, con la lógica de
 * `packages/shared`, aunque la petición venga del gateway.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  MENSAJE_ROL_INSUFICIENTE,
  ROL_PROPIETARIO,
  crearError,
  esPropietario as claimsSonDePropietario,
  verificarTokenConRevocacion,
} from 'arriendos360-shared';

import { tokenInvalidado } from '../services/tokenService';

export const verificarToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  const resultado = await verificarTokenConRevocacion(
    { authorization: req.headers['authorization'] },
    process.env['JWT_SECRET'],
    tokenInvalidado,
  );

  if (!resultado.valido) {
    return res.status(resultado.estado).json(resultado.error);
  }

  req.usuario = resultado.claims;
  return next();
};

/** Exige el rol PROPIETARIO. */
export const esPropietario = (req: Request, res: Response, next: NextFunction): Response | void => {
  if (claimsSonDePropietario(req.usuario)) {
    return next();
  }

  return res.status(403).json(crearError(MENSAJE_ROL_INSUFICIENTE));
};

export { ROL_PROPIETARIO };
