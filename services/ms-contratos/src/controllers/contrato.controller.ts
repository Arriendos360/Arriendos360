/**
 * Contratos. Las respuestas salen compuestas con `Inquilino` e `Inmueble`
 * (`services/composicion.ts`) y la autorización pasa por `services/pertenencia.ts`.
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

/** 502 cuando ms-inmuebles no responde; nunca se degrada a 403 ni a una lista vacía. */
const responderServicioCaido = (res: Response, error: unknown, accion: string): Response => {
  console.error(`Error al ${accion}:`, (error as Error).message);
  return res.status(502).json(crearError('No se pudo contactar el servicio de inmuebles'));
};

/** GET /api/contratos — los contratos donde el usuario es propietario o inquilino. */
export const obtenerTodos = async (req: Request, res: Response): Promise<Response> => {
  try {
    const sub = req.usuario?.sub as string;
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
      // 404 y no 403, para no confirmar que el contrato existe.
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

    // 0. El inmueble tiene que ser del propietario autenticado. Si ms-inmuebles
    //    no responde, 502.
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

    // Día límite: se valida si viene; si no, lo deriva el hook.
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

    // 2. El inquilino tiene que existir y tener el rol INQUILINO.
    const inquilino = esUuid(id_inquilino) ? await usuarioPorId(id_inquilino as string) : null;

    if (!inquilino || !(inquilino.roles ?? []).includes(ROL_INQUILINO)) {
      return res.status(404).json({
        mensaje: 'Inquilino no encontrado',
        error_code: 'TENANT_NOT_FOUND',
        id_inquilino,
      });
    }

    // 3. El contrato y su `ContratoFormalizado`, en una sola transacción.
    t = await sequelize.transaction();
    const nuevoContrato = await Contrato.create(contratoData, {
      transaction: t,
      usuarioAuditor: sub,
    });
    await registrarContratoFormalizado(nuevoContrato, t);
    await t.commit();
    t = null;

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

    // El cambio de estado y su `ContratoFinalizado`, en una transacción.
    await sequelize.transaction(async (transaccion) => {
      await contrato.update(
        { estado: ESTADO_CONTRATO_FINALIZADO },
        { transaction: transaccion, usuarioAuditor: sub },
      );
      await registrarContratoFinalizado(contrato, transaccion);
    });

    return res.json({ mensaje: 'Contrato finalizado', contrato });
  } catch (error) {
    console.error('Error al finalizar contrato:', (error as Error).message);
    return res
      .status(500)
      .json({ mensaje: 'Error al finalizar contrato', error: (error as Error).message });
  }
};

/**
 * POST /api/contratos/:id/contrasena-inquilino — regenera la contraseña temporal
 * del inquilino de un contrato propio y la devuelve una sola vez.
 */
export const reemitirContrasenaDelInquilino = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  let contrato;
  try {
    const sub = req.usuario?.sub as string;

    // El contrato tiene que ser sobre un inmueble de quien pide.
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
      // Única vez que viaja en claro.
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
