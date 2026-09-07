/**
 * Adaptador Express sobre la verificacion de token de `packages/shared`.
 *
 * CONFIANZA CERO (regla dura 7): este servicio verifica el token por su cuenta
 * aunque la peticion venga del gateway y el gateway ya lo haya verificado. No
 * es redundancia: el dia que alguien alcance la red interna sin pasar por el
 * gateway, esta es la unica comprobacion que queda en pie.
 *
 * Y verificar incluye la revocacion. Ese es el punto en el que ms-inmuebles se
 * diferencia de ms-identidad: alli la lista esta en su propia base y se
 * consulta en el momento; aqui es de otro servicio, asi que se lee de la copia
 * en memoria. La diferencia observable es la ventana de refresco — un logout
 * tarda hasta 15 segundos en surtir efecto aqui.
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

/**
 * Exige el rol PROPIETARIO.
 *
 * El gateway ya aplica su matriz RBAC, pero eso es la Capa 2 y esto es la Capa
 * 3: las dos tienen que sostenerse solas. Ademas esto solo dice que ERES
 * propietario; que seas ESTE propietario lo comprueba el ABAC del controlador,
 * que es el segundo nivel de la regla dura 8.
 */
export const esPropietario = (req: Request, res: Response, next: NextFunction): Response | void => {
  if (claimsSonDePropietario(req.usuario)) {
    return next();
  }

  return res.status(403).json(crearError(MENSAJE_ROL_INSUFICIENTE));
};
