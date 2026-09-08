/**
 * Contratos.
 *
 * ── QUE CAMBIA AL SALIR DEL GATEWAY, Y QUE NO ───────────────────────────────
 *
 * NO cambia la logica de negocio: las validaciones, los codigos de estado y los
 * mensajes son los mismos que servia el gateway. Lo que cambia es de donde salen
 * los datos que no son de aqui.
 *
 * COMPONER EL `Inquilino` Y EL `Inmueble` SE MUDA CON EL ENDPOINT, y conviene
 * decir por que, porque la regla dura 5 dice que las agregaciones se resuelven
 * en el gateway.
 *
 * La razon es la costura: el gateway reenvia `/api/contratos` entero y devuelve
 * la respuesta tal cual — no la abre ni la reescribe. Hacer que lo hiciera
 * significaria meter logica de dominio en el proxy. Asi que quien sirve el
 * endpoint tiene que devolverlo completo, y `contrato.Inmueble.direccion` sigue
 * siendo la ruta que el frontend lee desde antes de que Inmuebles se extrajera.
 *
 * La regla dura 5 sigue donde importa: el DASHBOARD, que cruza tres contextos y
 * no es de nadie, se resuelve en el gateway. Ver `services/composicion.ts`.
 *
 * Y la AUTORIZACION vive aqui porque depende de datos de este servicio. Toda
 * ella pasa por `services/pertenencia.ts`, que es el unico sitio donde esta
 * escrita.
 */

import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';

import { reemitirContrasenaTemporal, usuarioPorId } from '../clientes/identidad';
import { propioDe } from '../clientes/inmuebles';
import { sequelize } from '../config/database';
import { registrarContratoFinalizado, registrarContratoFormalizado } from '../eventos';
import { Contrato } from '../models/Contrato';
import { ESTADO_CONTRATO_FINALIZADO } from '../models/constantes';
import { esUuid } from '../models/uuid';
import { adjuntarPartes, adjuntarPartesA } from '../services/composicion';
import {
  contratoDondeEsParte,
  contratoPropio,
  contratosDondeEsParte,
} from '../services/pertenencia';

/** El rol que tiene que tener el inquilino de un contrato. */
const ROL_INQUILINO = 'INQUILINO';

/**
 * 502 con el formato de error del proyecto.
 *
 * Un fallo de ms-inmuebles NO se degrada a 403 ni a una lista vacia: decirle a
 * alguien «no tienes permisos» cuando en realidad no se ha podido comprobar es
 * la peor de las respuestas posibles.
 */
const responderServicioCaido = (res: Response, error: unknown, accion: string): Response => {
  console.error(`Error al ${accion}:`, (error as Error).message);
  return res.status(502).json(crearError('No se pudo contactar el servicio de inmuebles'));
};

/**
 * GET /api/contratos
 *
 * Los contratos en los que el usuario es parte: dueño del inmueble O inquilino.
 * La disyuncion la resuelve `contratosDondeEsParte` con un solo salto de red.
 */
export const obtenerTodos = async (req: Request, res: Response): Promise<Response> => {
  try {
    const sub = req.usuario?.sub as string;
    // Dos composiciones en paralelo para la lista entera, no dos por contrato.
    return res.json(await adjuntarPartes(await contratosDondeEsParte(sub)));
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener contratos');
  }
};

/** GET /api/contratos/:id */
export const obtenerPorId = async (req: Request, res: Response): Promise<Response> => {
  try {
    const sub = req.usuario?.sub as string;
    const contrato = await contratoDondeEsParte(req.params['id'] as string, sub);

    if (!contrato) {
      // 404 y no 403: un 403 confirmaria que ese identificador existe, que es
      // informacion que quien pregunta no tiene por que obtener probando UUID.
      return res.status(404).json(crearError('Contrato no encontrado'));
    }

    return res.json(await adjuntarPartesA(contrato));
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener contrato');
  }
};

/** POST /api/contratos */
export const crear = async (req: Request, res: Response): Promise<Response> => {
  let t = null;
  try {
    const sub = req.usuario?.sub as string;
    const cuerpo = req.body as Record<string, unknown>;
    const { id_inmueble, id_inquilino, inicio, fin, canon } = cuerpo;

    // Las columnas de auditoria no se aceptan del cliente: las pone el hook.
    const { creado_por, actualizado_por, ...contratoData } = cuerpo;
    void creado_por;
    void actualizado_por;

    // 0. El inmueble tiene que ser del propietario autenticado. Que el `sub` no
    //    salga de este proceso es deliberado: el que autoriza es quien lo tiene.
    //
    //    En su propio try/catch: un servicio caido es un 502, no un 500 con el
    //    mensaje interno dentro. Y sobre todo NO es un 403.
    let inmueble = null;
    try {
      inmueble = esUuid(id_inmueble) ? await propioDe(id_inmueble as string, sub) : null;
    } catch (error) {
      return responderServicioCaido(res, error, 'verificar el inmueble');
    }

    if (!inmueble) {
      return res.status(403).json(crearError('No tienes permisos sobre este inmueble'));
    }

    // 1. Validaciones de negocio.
    if (new Date(fin as string) <= new Date(inicio as string)) {
      return res
        .status(400)
        .json(crearError('La fecha de fin debe ser posterior a la de inicio'));
    }

    if (parseFloat(canon as string) <= 0) {
      return res.status(400).json(crearError('El canon debe ser un número positivo'));
    }

    // El dia limite llega del formulario, asi que se valida aqui y no solo en el
    // modelo: la validacion de Sequelize saldria por el `catch` de abajo como un
    // 500, y esto es un 400 de manual. Solo se mira si viene: si no, lo deriva
    // el hook.
    if (
      contratoData['fecha_limite_pago'] !== undefined &&
      contratoData['fecha_limite_pago'] !== ''
    ) {
      const dia = Number(contratoData['fecha_limite_pago']);

      if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
        return res
          .status(400)
          .json(crearError('La fecha límite de pago debe ser un día del mes (1-31)'));
      }

      // `multipart/form-data` lo entrega como cadena; la columna es entera.
      contratoData['fecha_limite_pago'] = dia;
    }

    // 2. El inquilino tiene que existir y ser inquilino. Un fallo de
    //    ms-identidad se traduce en «no encontrado», que es lo prudente: ante la
    //    duda no se firma un contrato contra un usuario que quiza no exista.
    const inquilino = esUuid(id_inquilino) ? await usuarioPorId(id_inquilino as string) : null;

    if (!inquilino || !(inquilino.roles ?? []).includes(ROL_INQUILINO)) {
      return res.status(404).json({
        mensaje: 'Inquilino no encontrado',
        error_code: 'TENANT_NOT_FOUND',
        id_inquilino,
      });
    }

    // 3. Guardar el contrato Y ANUNCIARLO, en una sola transaccion.
    //
    //    Las dos escrituras van a la misma base, asi que o quedan las dos o no
    //    queda ninguna. Es lo que devuelve la atomicidad que el ADR 0011 dio por
    //    perdida: no la del contrato con el estado del inmueble —eso ya no es
    //    posible ni deseable— sino la del contrato con el HECHO DE HABERLO
    //    ANUNCIADO, que es la que se puede tener y la que hace que el estado del
    //    inmueble acabe convergiendo.
    //
    //    Si el registro del evento falla, el contrato no se guarda. Es el orden
    //    correcto: un contrato que nadie anuncia deja el sistema inconsistente
    //    en silencio; uno que no se firma se le dice al usuario.
    t = await sequelize.transaction();
    const nuevoContrato = await Contrato.create(contratoData, {
      transaction: t,
      usuarioAuditor: sub,
    });
    await registrarContratoFormalizado(nuevoContrato, t);
    await t.commit();
    t = null;

    // El publicador entrega el evento y el inmueble pasa a `arrendado` en
    // cuestion de segundos; la respuesta no espera a eso y tampoco necesita
    // avisar de nada, porque no hay nada que se pueda haber perdido.
    return res.status(201).json({
      mensaje: 'Contrato creado exitosamente',
      contrato: nuevoContrato,
    });
  } catch (error) {
    if (t) await t.rollback();
    console.error('Error al crear contrato:', error);
    return res
      .status(500)
      .json({ mensaje: 'Error al crear contrato', error: (error as Error).message });
  }
};

/** PUT /api/contratos/:id */
export const actualizar = async (req: Request, res: Response): Promise<Response> => {
  try {
    const sub = req.usuario?.sub as string;
    const contrato = await contratoPropio(req.params['id'] as string, sub);

    if (!contrato) {
      return res
        .status(404)
        .json(crearError('Contrato no encontrado o no tienes permisos'));
    }

    const { creado_por, actualizado_por, ...cambios } = req.body as Record<string, unknown>;
    void creado_por;
    void actualizado_por;

    await contrato.update(cambios, { usuarioAuditor: sub });
    return res.json({ mensaje: 'Contrato actualizado', contrato });
  } catch (error) {
    return responderServicioCaido(res, error, 'actualizar contrato');
  }
};

/** PUT /api/contratos/:id/finalizar */
export const finalizar = async (req: Request, res: Response): Promise<Response> => {
  try {
    const sub = req.usuario?.sub as string;
    const contrato = await contratoPropio(req.params['id'] as string, sub);

    if (!contrato) {
      return res
        .status(404)
        .json(crearError('Contrato no encontrado o no tienes permisos'));
    }

    // Estado finalizado y anuncio, en la misma transaccion: son justamente las
    // dos escrituras que no pueden quedar desparejadas.
    await sequelize.transaction(async (transaccion) => {
      await contrato.update(
        { estado: ESTADO_CONTRATO_FINALIZADO },
        { transaction: transaccion, usuarioAuditor: sub },
      );
      await registrarContratoFinalizado(contrato, transaccion);
    });

    // La liberacion del inmueble la hace ms-inmuebles al consumir el evento.
    return res.json({ mensaje: 'Contrato finalizado', contrato });
  } catch (error) {
    console.error('Error al finalizar contrato:', (error as Error).message);
    return res
      .status(500)
      .json({ mensaje: 'Error al finalizar contrato', error: (error as Error).message });
  }
};

/**
 * POST /api/contratos/:id/contrasena-inquilino
 *
 * Regenera la contraseña temporal del inquilino de un contrato y la devuelve una
 * sola vez, para que el propietario se la entregue. Existe porque la temporal
 * del alta se muestra una vez y no se puede volver a consultar: si se pierde
 * antes de entregarla, no habria forma de generar otra.
 *
 * ── POR QUE AHORA VIVE AQUI ─────────────────────────────────────────────────
 *
 * El `docs/adr/0010` la puso en el gateway porque la regla de autorizacion es
 * «solo sobre inquilinos con contrato en mis inmuebles», y eso eran datos de
 * contratos —del gateway— e inmuebles. Ms-identidad no podia comprobarlo sin
 * depender de un servicio de dominio.
 *
 * El argumento no ha cambiado; ha cambiado quien tiene los datos. Los contratos
 * son de este servicio, y preguntar por el inmueble es Core -> Soporte, que es
 * la direccion correcta. Dejarla en el gateway obligaria a que el gateway
 * volviera a saber que es un contrato justo despues de habersela quitado. Ver
 * `docs/adr/0017`.
 *
 * La ruta cuelga del contrato a proposito: el contrato ES lo que autoriza.
 */
export const reemitirContrasenaDelInquilino = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  let contrato;
  try {
    const sub = req.usuario?.sub as string;

    // ABAC de pertenencia (regla dura 8): el contrato tiene que ser sobre un
    // inmueble de quien pide. Se responde 404 y no 403 para no confirmar que el
    // contrato existe.
    contrato = await contratoPropio(req.params['id'] as string, sub);

    if (!contrato) {
      return res
        .status(404)
        .json(crearError('Contrato no encontrado o no tienes permisos'));
    }
  } catch (error) {
    return responderServicioCaido(res, error, 'verificar el contrato');
  }

  try {
    const resultado = await reemitirContrasenaTemporal(
      contrato.id_inquilino,
      req.usuario?.sub as string,
    );

    return res.json({
      mensaje: 'Contraseña temporal regenerada',
      // Unica vez que viaja en claro, igual que en el alta. No se guarda, no se
      // registra y no hay forma de volver a consultarla.
      contrasena_temporal: resultado.contrasena_temporal,
      inquilino: resultado.usuario,
    });
  } catch (error) {
    console.error(
      'Error al reemitir la contraseña del inquilino:',
      (error as Error).message,
    );
    return res.status(502).json(crearError('No se pudo regenerar la contraseña temporal'));
  }
};
