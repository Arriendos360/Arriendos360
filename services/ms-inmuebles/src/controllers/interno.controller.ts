/**
 * Endpoints que llama otro servicio, no una persona.
 *
 * Ninguno lleva token de usuario ni pasa por la matriz RBAC: la credencial es un
 * JWT de servicio, que `interno.routes.ts` exige de una sola vez para todo el
 * router. Y ninguno comprueba autorizacion de negocio, porque no puede: quien
 * llama ya la comprobo con datos que este servicio no tiene.
 */

import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';
import { esEstadoInmueble } from 'arriendos360-contracts';

import { Inmueble } from '../models/Inmueble';
import { esUuid } from '../models/uuid';

/**
 * GET /interno/inmuebles?propietario=<uuid>  |  ?ids=<uuid>,<uuid>
 *
 * Lo que el gateway necesita para resolver todo lo que antes era un `include`.
 *
 * `propietario` responde a «que inmuebles son suyos», que es como se filtran sus
 * contratos y sus pagos ahora que no hay JOIN posible.
 *
 * `ids` responde a «dame estos», en LOTE, que es lo que hace falta al pintar un
 * listado. De uno en uno seria el N+1 de siempre, pero con latencia de red.
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
      // Los que no tienen forma de UUID se descartan aqui y no en la consulta:
      // PostgreSQL rechazaria el tipo y saldria un 500 por una entrada mala.
      const solicitados = ids.split(',').map((valor) => valor.trim()).filter(esUuid);

      if (solicitados.length === 0) {
        return res.json({ inmuebles: [] });
      }

      const inmuebles = await Inmueble.findAll({ where: { id_inmueble: solicitados } });
      return res.json({ inmuebles });
    }

    // Sin filtro no se devuelve la tabla entera. Este endpoint sirve para
    // componer respuestas de alguien concreto, no para volcar el catalogo.
    return res.status(400).json(crearError('Indica `propietario` o `ids`'));
  } catch (error) {
    console.error('Error al listar inmuebles:', (error as Error).message);
    return res.status(500).json(crearError('Error al listar inmuebles'));
  }
};

/**
 * POST /interno/inmuebles/:id/estado
 *
 * Mueve el estado de ocupacion. Es la operacion que antes hacia
 * `contrato.controller.js` con un `Inmueble.update(...)` DENTRO de la misma
 * transaccion que guardaba el contrato. Eso ya no es posible: son dos bases
 * logicas distintas y no hay transaccion que las abarque.
 *
 * NO VALIDA SI EL CAMBIO TIENE SENTIDO DE NEGOCIO. Que un inmueble deba pasar a
 * `arrendado` porque se firmo un contrato, o volver a `disponible` porque se
 * finalizo, son reglas de Contratos. Este servicio es de Soporte y no conoce la
 * existencia de los contratos; comprobarlo aqui invertiria la direccion de las
 * dependencias. Lo que si valida es que el estado exista en el catalogo y que el
 * inmueble tambien.
 *
 * ES IDEMPOTENTE: poner `arrendado` sobre un inmueble ya arrendado responde 200
 * y no cambia nada. Es deliberado, y es lo que hace que el reintento del
 * llamante sea seguro cuando la primera llamada fallo despues de aplicarse.
 * Ver `docs/adr/0011`.
 */
export const cambiarEstado = async (req: Request, res: Response): Promise<Response> => {
  try {
    const id = req.params['id'];
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    const estado = cuerpo['estado'];
    const solicitadoPor = cuerpo['solicitado_por'];

    if (!esEstadoInmueble(estado)) {
      return res.status(400).json(crearError('Estado no válido'));
    }

    const inmueble = esUuid(id) ? await Inmueble.findByPk(id) : null;

    if (!inmueble) {
      return res.status(404).json(crearError('Inmueble no encontrado'));
    }

    await inmueble.update(
      { estado },
      // Quien lo PIDIO, no quien lo transmitio: el gateway manda el `sub` del
      // propietario. El `iss` del token de servicio seria "gateway", que no es
      // un UUID y ademas perderia el dato que importa auditar.
      { usuarioAuditor: esUuid(solicitadoPor) ? solicitadoPor : undefined } as never,
    );

    return res.json({ mensaje: 'Estado actualizado', inmueble });
  } catch (error) {
    console.error('Error al cambiar el estado del inmueble:', (error as Error).message);
    return res.status(500).json(crearError('Error al cambiar el estado del inmueble'));
  }
};
