/** Recepción de eventos del bus, única entrada del servicio: adaptador Express sobre el consumidor. */

import type { Request, Response } from 'express';

import { consumidor } from '../eventos';

/**
 * POST /interno/eventos
 *
 * - `200` — procesado, ya procesado o tipo sin manejador.
 * - `400` — sobre mal formado.
 * - `500` — no se pudo procesar (p. ej. ms-identidad no respondió); el productor
 *   lo reintentará.
 */
export const recibir = async (req: Request, res: Response): Promise<Response> => {
  const { estado, cuerpo } = await consumidor.recibir(req.body);
  return res.status(estado).json(cuerpo);
};
