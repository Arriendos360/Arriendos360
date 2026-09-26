/**
 * Verificación del token de usuario en el servicio, aunque la petición venga del
 * gateway. La revocación se consulta en la copia en memoria.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  MENSAJE_ROL_INSUFICIENTE,
  crearError,
  esPropietario as claimsSonDePropietario,
  verificarTokenConRevocacion,
} from 'arriendos360-shared';

import { cache } from '../seguridad/cache';

export const verificarToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  const resultado = await verificarTokenConRevocacion(
    { authorization: req.headers['authorization'] },
    process.env['JWT_SECRET'],
    cache.tokenInvalidado,
  );

  if (!resultado.valido) {
    return res.status(resultado.estado).json(resultado.error);
  }

  req.usuario = resultado.claims;
  return next();
};

/** Exige el rol PROPIETARIO. La pertenencia la comprueba el controlador. */
export const esPropietario = (req: Request, res: Response, next: NextFunction): Response | void => {
  if (claimsSonDePropietario(req.usuario)) {
    return next();
  }

  return res.status(403).json(crearError(MENSAJE_ROL_INSUFICIENTE));
};
