/**
 * Endpoints para otros servicios. La credencial de servicio la exige el router.
 * Exponen hechos de pertenencia (`services/pertenencia.ts`); el código de estado
 * lo decide quien pregunta.
 */

import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';

import { Contrato } from '../models/Contrato';
import { adjuntarInmuebles } from '../services/composicion';
import { ESTADO_CONTRATO_ACTIVO } from '../models/constantes';
import { esUuid } from '../models/uuid';
import {
  contratoPropio,
  contratosActivosDeInmueble,
  contratosDePropietario,
  contratosDondeEsParte,
} from '../services/pertenencia';

/** 502 si ms-inmuebles no responde; nunca una lista vacía. */
const responderServicioCaido = (res: Response, error: unknown, accion: string): Response => {
  console.error(`Error al ${accion}:`, (error as Error).message);
  return res.status(502).json(crearError('No se pudo contactar el servicio de inmuebles'));
};

/** ¿Pidieron el inmueble dentro (`?incluir=inmueble`)? */
const conInmueble = (req: Request): boolean => req.query['incluir'] === 'inmueble';

/** Responde la lista, con el inmueble dentro si lo pidieron. */
const responderContratos = async (
  req: Request,
  res: Response,
  contratos: Contrato[],
): Promise<Response> =>
  res.json({ contratos: conInmueble(req) ? await adjuntarInmuebles(contratos) : contratos });

/**
 * GET /interno/contratos
 *
 *   `?parte=<uuid>`        — donde ese usuario es dueño del inmueble O inquilino.
 *   `?propietario=<uuid>`  — sólo donde es dueño del inmueble.
 *   `?inquilino=<uuid>`    — sólo donde es inquilino.
 *   `?ids=a,b,c`           — por identificador, en lote.
 *   `?inmueble=<uuid>[&estado=activo]`
 *                          — los de un inmueble (activos, con `estado=activo`).
 *   `?estado=<estado>`     — todos los de ese estado (barrido del motor).
 *
 * `?incluir=inmueble` adjunta el `Inmueble` de cada contrato. Sin filtro, 400.
 */
export const listar = async (req: Request, res: Response): Promise<Response> => {
  const { parte, propietario, inquilino, ids, inmueble, estado } = req.query;

  try {
    if (esUuid(parte)) {
      return await responderContratos(req, res, await contratosDondeEsParte(parte));
    }

    if (esUuid(propietario)) {
      return await responderContratos(req, res, await contratosDePropietario(propietario));
    }

    if (esUuid(inquilino)) {
      const contratos = await Contrato.findAll({ where: { id_inquilino: inquilino } });
      return await responderContratos(req, res, contratos);
    }

    if (esUuid(inmueble)) {
      const contratos =
        estado === ESTADO_CONTRATO_ACTIVO
          ? await contratosActivosDeInmueble(inmueble)
          : await Contrato.findAll({ where: { id_inmueble: inmueble } });

      return await responderContratos(req, res, contratos);
    }

    if (typeof ids === 'string') {
      // Se descartan los que no son UUID, que PostgreSQL rechazaría.
      const solicitados = ids
        .split(',')
        .map((valor) => valor.trim())
        .filter(esUuid);

      if (solicitados.length === 0) {
        return res.json({ contratos: [] });
      }

      const contratos = await Contrato.findAll({ where: { id_contrato: solicitados } });
      return await responderContratos(req, res, contratos);
    }

    // Barrido del motor financiero: todos los de un estado.
    if (typeof estado === 'string' && estado !== '') {
      const contratos = await Contrato.findAll({ where: { estado } });
      return await responderContratos(req, res, contratos);
    }

    return res
      .status(400)
      .json(crearError('Indica `parte`, `propietario`, `inquilino`, `ids`, `inmueble` o `estado`'));
  } catch (error) {
    return responderServicioCaido(res, error, 'listar contratos');
  }
};

/**
 * GET /interno/contratos/:id[?propietario=<uuid>] — el contrato, o 404. Con
 * `propietario`, sólo si es sobre un inmueble suyo.
 */
export const obtenerPorId = async (req: Request, res: Response): Promise<Response> => {
  const id = req.params['id'] as string;
  const { propietario } = req.query;

  try {
    if (esUuid(propietario)) {
      const contrato = await contratoPropio(id, propietario);

      return contrato
        ? res.json({ contrato })
        : res.status(404).json(crearError('Contrato no encontrado'));
    }

    const contrato = esUuid(id) ? await Contrato.findByPk(id) : null;

    return contrato
      ? res.json({ contrato })
      : res.status(404).json(crearError('Contrato no encontrado'));
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener contrato');
  }
};
