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
 * AQUI VIVIA `cambiarEstado`, el manejador de `POST /interno/inmuebles/:id/estado`.
 *
 * Movia el estado de ocupacion cuando el gateway lo pedia justo despues de
 * guardar un contrato: el mecanismo provisional del ADR 0011, con su ventana sin
 * atomicidad. El paso 5 lo sustituyo por el consumo de `ContratoFormalizado` y
 * `ContratoFinalizado` (`src/eventos/`), y el endpoint se retiro por completo.
 *
 * Lo que NO cambio es de quien es la decision: este servicio sigue sin saber que
 * existen los contratos. Antes obedecia una orden, ahora interpreta un hecho;
 * en los dos casos la regla «un contrato firmado ocupa el inmueble» es de
 * Contratos, y comprobarla aqui invertiria la direccion de las dependencias.
 */
