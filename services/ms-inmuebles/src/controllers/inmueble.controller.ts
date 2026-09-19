/**
 * Inmuebles del propietario autenticado.
 *
 * AUTORIZACION EN DOS NIVELES (regla dura 8). El primero lo puso la matriz RBAC
 * del gateway y lo repite `esPropietario`: quien llama tiene rol de propietario.
 * El segundo esta aqui, y es el que importa: que el inmueble sobre el que se
 * opera sea de ESTE propietario. El rol dice que puedes tener inmuebles, no que
 * este sea tuyo.
 *
 * La comprobacion es EXPLICITA en cada operacion sobre un recurso concreto, y no
 * un filtro de listado heredado. `buscarPropio` es una sola funcion que los
 * cuatro caminos usan, para que no haya una operacion que se olvide de mirar.
 *
 * El `id_propietario` sale siempre del `sub` del token y nunca del cuerpo
 * (regla dura 4). Un `id_propietario` en el payload se descarta en silencio: no
 * es un error del cliente, es un campo que no le corresponde poner.
 *
 * SE RESPONDE 404 Y NO 403 cuando el inmueble existe pero es de otro. Distinguir
 * los dos casos le confirmaria a cualquiera que un identificador corresponde a
 * un inmueble real: para quien pregunta, un inmueble ajeno y uno inexistente son
 * lo mismo. Ver `docs/adr/0005`.
 */

import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';
import { TIPOS_INMUEBLE, esTipoInmueble } from 'arriendos360-contracts';

import { Inmueble } from '../models/Inmueble';
import { esUuid } from '../models/uuid';

/** Columnas que el cliente nunca escribe, las ponga o no en el cuerpo. */
const NO_ESCRIBIBLES = ['id_inmueble', 'id_propietario', 'creado_por', 'actualizado_por', 'estado'];

/**
 * Quita del cuerpo lo que no le toca escribir al cliente.
 *
 * `estado` esta en la lista y no es un descuido: no lo mueve una persona
 * editando un formulario, lo mueve el ciclo de vida del contrato a traves de
 * `/interno`. Aceptarlo aqui permitiria marcar como disponible un inmueble con
 * contrato vigente. Ver `docs/adr/0011`.
 */
const soloCamposDeNegocio = (cuerpo: unknown): Record<string, unknown> => {
  const entrada = (cuerpo ?? {}) as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(entrada).filter(([campo]) => !NO_ESCRIBIBLES.includes(campo)),
  );
};

const MENSAJE_NO_ENCONTRADO = 'Inmueble no encontrado o no tienes permisos';

/**
 * El inmueble, solo si es de quien pregunta.
 *
 * Devuelve `null` tanto si no existe como si es de otro: los dos casos acaban en
 * el mismo 404 y quien llama no tiene por que distinguirlos.
 */
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

    // El tipo se valida ANTES de llegar al modelo para poder devolver un 400 con
    // el catalogo entero. Si se dejara caer al `isIn` de Sequelize saldria un
    // ValidationError que este catch traduciria a 500.
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

    // Solo se valida si viene: una actualizacion parcial que no toca el tipo no
    // tiene por que mandarlo.
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
 * DELETE /api/inmuebles/:id
 *
 * NO comprueba si hay un contrato activo. Esa regla existe y se aplica, pero en
 * el gateway: depende de `contratos`, que es un subdominio de Core, y este
 * servicio es de Soporte. Consultarlo desde aqui invertiria la direccion de las
 * dependencias. Ver `docs/adr/0011`.
 *
 * Lo que si es responsabilidad de este endpoint es la pertenencia, y eso si se
 * comprueba.
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
