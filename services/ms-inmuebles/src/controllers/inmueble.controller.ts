/**
 * Inmuebles del propietario autenticado.
 *
 * Cada operación sobre un inmueble comprueba que sea de quien pregunta
 * (`buscarPropio`); si es de otro, responde 404, igual que si no existiera.
 * `id_propietario` sale siempre del `sub` del token.
 */

import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';
import { TIPOS_INMUEBLE, esTipoInmueble } from 'arriendos360-contracts';

import { Inmueble } from '../models/Inmueble';
import { esUuid } from '../models/uuid';

/** Columnas que el cliente nunca escribe, las ponga o no en el cuerpo. */
const NO_ESCRIBIBLES = ['id_inmueble', 'id_propietario', 'creado_por', 'actualizado_por', 'estado'];

/** Quita del cuerpo lo que no le toca escribir al cliente. `estado` lo mueven los eventos. */
const soloCamposDeNegocio = (cuerpo: unknown): Record<string, unknown> => {
  const entrada = (cuerpo ?? {}) as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(entrada).filter(([campo]) => !NO_ESCRIBIBLES.includes(campo)),
  );
};

const MENSAJE_NO_ENCONTRADO = 'Inmueble no encontrado o no tienes permisos';

/** El inmueble, sólo si es de quien pregunta; `null` si no existe o es de otro. */
const buscarPropio = async (id: unknown, sub: string): Promise<Inmueble | null> => {
  if (!esUuid(id)) {
    return null;
  }

  return Inmueble.findOne({ where: { id_inmueble: id, id_propietario: sub } });
};

const mensajeTipoInvalido = (): string =>
  `El tipo de inmueble debe ser uno de: ${TIPOS_INMUEBLE.join(', ')}`;

// GET /api/inmuebles
export const obtenerTodos = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sub } = req.usuario!;

    const inmuebles = await Inmueble.findAll({
      where: { id_propietario: sub },
      order: [['fecha_creacion', 'DESC']],
    });

    return res.json(inmuebles);
  } catch (error) {
    console.error('Error al obtener inmuebles:', (error as Error).message);
    return res.status(500).json(crearError('Error al obtener inmuebles'));
  }
};

// GET /api/inmuebles/:id
export const obtenerPorId = async (req: Request, res: Response): Promise<Response> => {
  try {
    const inmueble = await buscarPropio(req.params['id'], req.usuario!.sub);

    if (!inmueble) {
      return res.status(404).json(crearError(MENSAJE_NO_ENCONTRADO));
    }

    return res.json(inmueble);
  } catch (error) {
    console.error('Error al obtener inmueble:', (error as Error).message);
    return res.status(500).json(crearError('Error al obtener inmueble'));
  }
};

// POST /api/inmuebles
export const crear = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sub } = req.usuario!;
    const datos = soloCamposDeNegocio(req.body);

    // Se valida antes del modelo para responder 400 con el catálogo.
    if (!esTipoInmueble(datos['tipo'])) {
      return res.status(400).json(crearError(mensajeTipoInvalido()));
    }

    if (typeof datos['direccion'] !== 'string' || datos['direccion'].trim() === '') {
      return res.status(400).json(crearError('La dirección es obligatoria'));
    }

    const inmueble = await Inmueble.create(
      { ...datos, id_propietario: sub },
      { usuarioAuditor: sub } as never,
    );

    return res.status(201).json({ mensaje: 'Inmueble creado exitosamente', inmueble });
  } catch (error) {
    console.error('Error al crear inmueble:', (error as Error).message);
    return res.status(500).json(crearError('Error al crear inmueble'));
  }
};

// PUT /api/inmuebles/:id
export const actualizar = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sub } = req.usuario!;
    const inmueble = await buscarPropio(req.params['id'], sub);

    if (!inmueble) {
      return res.status(404).json(crearError(MENSAJE_NO_ENCONTRADO));
    }

    const cambios = soloCamposDeNegocio(req.body);

    // Sólo se valida si viene.
    if ('tipo' in cambios && !esTipoInmueble(cambios['tipo'])) {
      return res.status(400).json(crearError(mensajeTipoInvalido()));
    }

    await inmueble.update(cambios, { usuarioAuditor: sub } as never);

    return res.json({ mensaje: 'Inmueble actualizado', inmueble });
  } catch (error) {
    console.error('Error al actualizar inmueble:', (error as Error).message);
    return res.status(500).json(crearError('Error al actualizar inmueble'));
  }
};

/**
 * DELETE /api/inmuebles/:id — comprueba la pertenencia. Que no tenga contrato
 * activo lo comprueba el guardia del gateway.
 */
export const eliminar = async (req: Request, res: Response): Promise<Response> => {
  try {
    const inmueble = await buscarPropio(req.params['id'], req.usuario!.sub);

    if (!inmueble) {
      return res.status(404).json(crearError(MENSAJE_NO_ENCONTRADO));
    }

    await inmueble.destroy();

    return res.json({ mensaje: 'Inmueble eliminado' });
  } catch (error) {
    console.error('Error al eliminar inmueble:', (error as Error).message);
    return res.status(500).json(crearError('Error al eliminar inmueble'));
  }
};
