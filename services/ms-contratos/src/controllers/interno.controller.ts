/**
 * Endpoints que llama otro servicio, no una persona.
 *
 * Ninguno lleva token de usuario ni pasa por la matriz RBAC: la credencial es un
 * JWT de servicio, que `interno.routes.ts` exige de una sola vez para todo el
 * router.
 *
 * ── ESTE `/interno` HACE ALGO QUE EL DE MS-INMUEBLES NO HACE ────────────────
 *
 * El de ms-inmuebles no comprueba autorizacion de negocio, porque no puede:
 * quien llama ya la comprobo con datos que aquel servicio no tiene. Aqui pasa lo
 * contrario, y por eso este archivo existe.
 *
 * «¿Es este contrato de este propietario?» depende de DOS contextos —el contrato
 * esta aqui, el dueño del inmueble en ms-inmuebles— y el gateway no puede
 * responderla desde que los contratos se fueron. Podria pedir las dos piezas y
 * cruzarlas, que es lo que hacia; seria una tercera copia de la regla, y ademas
 * dos saltos de red donde cabe uno.
 *
 * Asi que la responde quien tiene la mitad cara y sabe pedir la otra: este
 * servicio. Core preguntando a Soporte, que es la direccion buena. Lo que NO se
 * hace es exponer una decision («¿puede este usuario?»): se exponen HECHOS
 * —estos son sus contratos, este contrato es suyo— y quien pregunta decide que
 * codigo devolver. La diferencia importa: un 403 o un 409 los sigue eligiendo el
 * gateway, que es el que sabe que peticion se esta atendiendo.
 *
 * Toda la logica esta en `services/pertenencia.ts`, que es el mismo modulo que
 * usan los controladores de este servicio. Una sola regla, cuatro consumidores.
 */

import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';

import { Contrato } from '../models/Contrato';
import { ESTADO_CONTRATO_ACTIVO } from '../models/constantes';
import { esUuid } from '../models/uuid';
import {
  contratoPropio,
  contratosActivosDeInmueble,
  contratosDePropietario,
  contratosDondeEsParte,
} from '../services/pertenencia';

/**
 * Un fallo de ms-inmuebles al resolver la pertenencia sale como 502.
 *
 * Quien llama lo propaga tal cual: un 502 del gateway hacia arriba. Nunca una
 * lista vacia, que le diria a un propietario «no tienes contratos» — creible y
 * falso.
 */
const responderServicioCaido = (res: Response, error: unknown, accion: string): Response => {
  console.error(`Error al ${accion}:`, (error as Error).message);
  return res.status(502).json(crearError('No se pudo contactar el servicio de inmuebles'));
};

/**
 * GET /interno/contratos
 *
 * Cinco preguntas, un endpoint, y las cinco son «dame contratos que cumplan
 * esto». Se eligen por parametro:
 *
 *   `?parte=<uuid>`        — donde ese usuario es dueño del inmueble O inquilino.
 *                            Es la disyuncion completa del proyecto, y lo que el
 *                            gateway usa para filtrar cuentas de cobro.
 *   `?propietario=<uuid>`  — solo la mitad de propietario.
 *   `?inquilino=<uuid>`    — solo la mitad de inquilino. Local, sin salto.
 *   `?ids=a,b,c`           — por identificador, EN LOTE. Es lo que hace falta
 *                            para componer un listado sin caer en el N+1.
 *   `?inmueble=<uuid>&estado=activo`
 *                          — los contratos vivos de un inmueble, para el guardia
 *                            de borrado del gateway.
 *
 * Sin filtro NO se devuelve la tabla entera: este endpoint sirve para componer
 * respuestas de alguien concreto, no para volcar el catalogo. El motor
 * financiero es la unica excepcion y usa `?estado=activo` a secas, que es un
 * barrido del sistema y no de un usuario.
 */
export const listar = async (req: Request, res: Response): Promise<Response> => {
  const { parte, propietario, inquilino, ids, inmueble, estado } = req.query;

  try {
    if (esUuid(parte)) {
      return res.json({ contratos: await contratosDondeEsParte(parte) });
    }

    if (esUuid(propietario)) {
      return res.json({ contratos: await contratosDePropietario(propietario) });
    }

    if (esUuid(inquilino)) {
      const contratos = await Contrato.findAll({ where: { id_inquilino: inquilino } });
      return res.json({ contratos });
    }

    if (esUuid(inmueble)) {
      // Con `estado=activo` es la pregunta del guardia de borrado. Sin estado,
      // todos los del inmueble.
      const contratos =
        estado === ESTADO_CONTRATO_ACTIVO
          ? await contratosActivosDeInmueble(inmueble)
          : await Contrato.findAll({ where: { id_inmueble: inmueble } });

      return res.json({ contratos });
    }

    if (typeof ids === 'string') {
      // Los que no tienen forma de UUID se descartan aqui y no en la consulta:
      // PostgreSQL rechazaria el tipo y saldria un 500 por una entrada mala.
      const solicitados = ids
        .split(',')
        .map((valor) => valor.trim())
        .filter(esUuid);

      if (solicitados.length === 0) {
        return res.json({ contratos: [] });
      }

      const contratos = await Contrato.findAll({ where: { id_contrato: solicitados } });
      return res.json({ contratos });
    }

    // El barrido del motor financiero: todos los activos del sistema. Es el
    // unico caso sin sujeto, y se declara aparte para que se vea que lo es.
    if (typeof estado === 'string' && estado !== '') {
      const contratos = await Contrato.findAll({ where: { estado } });
      return res.json({ contratos });
    }

    return res
      .status(400)
      .json(crearError('Indica `parte`, `propietario`, `inquilino`, `ids`, `inmueble` o `estado`'));
  } catch (error) {
    return responderServicioCaido(res, error, 'listar contratos');
  }
};

/**
 * GET /interno/contratos/:id[?propietario=<uuid>]
 *
 * Sin `propietario`, devuelve el contrato o 404. Con `propietario`, devuelve el
 * contrato SOLO si es sobre un inmueble suyo — es la comprobacion de pertenencia
 * que el gateway necesita para autorizar un cobro o una anulacion sin tener que
 * saber nada de inmuebles.
 *
 * Devuelve 404 y no `{ pertenece: false }` a proposito: el llamante casi siempre
 * quiere el contrato ademas de la respuesta, y un endpoint que devuelve un
 * booleano obliga a una segunda llamada para obtenerlo.
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
