/** Endpoints para otros servicios. La credencial de servicio la exige el router. */

import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';

import { Inmueble } from '../models/Inmueble';
import { esUuid } from '../models/uuid';

/**
 * GET /interno/inmuebles?propietario=<uuid>  |  ?ids=<uuid>,<uuid>
 *
 * Los inmuebles de un propietario, o varios por id en lote. Sin filtro, 400.
 */
export const listar = async (req: Request, res: Response): Promise<Response> => {
  try {
    const propietario = req.query['propietario'];
    const ids = req.query['ids'];

    if (esUuid(propietario)) {
      const inmuebles = await Inmueble.findAll({ where: { id_propietario: propietario } });
      return res.json({ inmuebles });
    }

    if (typeof ids === 'string') {
      // Se descartan los que no son UUID, que PostgreSQL rechazaría.
      const solicitados = ids.split(',').map((valor) => valor.trim()).filter(esUuid);

      if (solicitados.length === 0) {
        return res.json({ inmuebles: [] });
      }

      const inmuebles = await Inmueble.findAll({ where: { id_inmueble: solicitados } });
      return res.json({ inmuebles });
    }

    return res.status(400).json(crearError('Indica `propietario` o `ids`'));
  } catch (error) {
    console.error('Error al listar inmuebles:', (error as Error).message);
    return res.status(500).json(crearError('Error al listar inmuebles'));
  }
};
