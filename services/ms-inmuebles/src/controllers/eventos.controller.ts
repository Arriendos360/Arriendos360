/**
 * Recepcion de eventos del bus.
 *
 * Tres lineas, y a proposito: la logica —validar el sobre, descartar repetidos,
 * aplicar el manejador en una transaccion, traducir el fallo a un codigo— vive
 * en `packages/shared`, para que el siguiente servicio que consuma eventos no
 * tenga que reescribirla ni pueda desviarse de ella. Lo unico que este archivo
 * aporta es el adaptador a Express.
 *
 * VA BAJO `/interno` porque lo llama un servicio, no una persona: sin token de
 * usuario, sin pasar por la matriz RBAC del gateway y con credencial de
 * servicio, que `interno.routes.ts` exige para todo el router.
 */

import type { Request, Response } from 'express';

import { consumidor } from '../eventos';

/**
 * POST /interno/eventos
 *
 * Los codigos importan porque son la señal que gobierna el reintento del
 * productor:
 *
 * - `200` — procesado, o ya estaba procesado, o el tipo no interesa aqui. En los
 *   tres casos el productor puede marcarlo entregado y olvidarse.
 * - `400` — el sobre no tiene forma de sobre. Reintentarlo no lo va a arreglar,
 *   pero tampoco se acepta: acabara apartado en la tabla del emisor, que es
 *   donde tiene que verse un error del emisor.
 * - `500` — no se pudo procesar. Nada quedo escrito, porque la anotacion se fue
 *   con la transaccion; el productor lo reintentara.
 */
export const recibir = async (req: Request, res: Response): Promise<Response> => {
  const { estado, cuerpo } = await consumidor.recibir(req.body);
  return res.status(estado).json(cuerpo);
};
