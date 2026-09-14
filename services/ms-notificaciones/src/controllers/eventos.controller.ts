/**
 * Recepcion de eventos del bus. La UNICA entrada de este servicio.
 *
 * Tres lineas, y es identico al de ms-inmuebles y al de ms-financiero porque tiene
 * que serlo: validar el sobre, descartar repetidos, aplicar el manejador en una
 * transaccion y traducir el fallo a un codigo vive en `packages/shared`, para que
 * ningun consumidor lo reescriba ni pueda desviarse de ello. Lo unico que este
 * archivo aporta es el adaptador a Express.
 *
 * ── AQUI NO HAY «ADEMAS DE ESTO»: ES TODO LO QUE EL SERVICIO EXPONE ─────────
 *
 * Los otros dos consumidores tienen tambien una API publica bajo `/api`. Este no:
 * no aparece en la costura de enrutamiento del gateway, no tiene filas en la matriz
 * RBAC y ninguna persona lo llama nunca. Un subdominio Generico que solo reacciona.
 *
 * Va bajo `/interno` con credencial de servicio, que `interno.routes.ts` exige para
 * todo el router. Sin ella, cualquiera con acceso al puerto podria mandarle un
 * correo a quien quisiera inventandose un sobre — y con el texto de un aviso del
 * sistema, que es exactamente la forma de un correo de phishing creible.
 */

import type { Request, Response } from 'express';

import { consumidor } from '../eventos';

/**
 * POST /interno/eventos
 *
 * Los codigos importan porque son la señal que gobierna el reintento del productor:
 *
 * - `200` — procesado, o ya estaba procesado, o el tipo no interesa aqui. En los
 *   tres casos el productor puede marcarlo entregado y olvidarse.
 * - `400` — el sobre no tiene forma de sobre. Reintentarlo no lo va a arreglar,
 *   pero tampoco se acepta: acabara apartado en la tabla del emisor, que es donde
 *   tiene que verse un error del emisor.
 * - `500` — no se pudo procesar. Nada quedo escrito, porque la anotacion y los
 *   envios se fueron con la transaccion; el productor lo reintentara.
 *
 * El `500` es el que hace de verdad el trabajo aqui, y merece la pena saber por
 * que: el caso tipico no es un error de programacion sino que ms-identidad no
 * contesto y no se pudo resolver a quien avisar. Devolver `200` ahi seria dar el
 * aviso por procesado y perderlo para siempre.
 */
export const recibir = async (req: Request, res: Response): Promise<Response> => {
  const { estado, cuerpo } = await consumidor.recibir(req.body);
  return res.status(estado).json(cuerpo);
};
