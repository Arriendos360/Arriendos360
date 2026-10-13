/**
 * Contratos. Las respuestas salen compuestas con `Inquilino` e `Inmueble`
 * (`services/composicion.ts`) y la autorización pasa por `services/pertenencia.ts`.
 */

import type { Request, Response } from 'express';
import { ajusteDeCanon, crearError, hoyEnZonaNegocio } from 'arriendos360-shared';
import { IPC_ANUAL, errorDeValidacion, validarContrato } from 'arriendos360-contracts';

import { reemitirContrasenaTemporal, usuarioPorId } from '../clientes/identidad';
import { propioDe } from '../clientes/inmuebles';
import type { InmuebleAjeno } from '../clientes/inmuebles';
import { sequelize } from '../config/database';
import {
  registrarCanonAjustado,
  registrarContratoFinalizado,
  registrarContratoFormalizado,
} from '../eventos';
import { Contrato } from '../models/Contrato';
import { ESTADO_CONTRATO_ACTIVO, ESTADO_CONTRATO_FINALIZADO } from '../models/constantes';
import { esUuid } from '../models/uuid';
import { adjuntarPartes, adjuntarPartesA, conAjusteCanon } from '../services/composicion';
import { documentoContrato } from '../services/documentoContrato';
import type { DatosContrato, Persona } from '../services/documentoContrato';
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
    const contratos = await adjuntarPartes(await contratosDondeEsParte(sub));
    return res.json(contratos.map((contrato) => conAjusteCanon(contrato, sub)));
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

    return res.json(conAjusteCanon(await adjuntarPartesA(contrato), sub));
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener contrato');
  }
};

/**
 * GET /api/contratos/:id/documento — el contrato en PDF, para las dos partes. Si falta una
 * parte, 502: un contrato a medias no sirve para firmar.
 */
export const documento = async (req: Request, res: Response): Promise<Response | void> => {
  let datos: DatosContrato;
  try {
    const contrato = await contratoDondeEsParte(req.params['id'] as string, req.usuario?.sub as string);

    if (!contrato) {
      return res.status(404).json(crearError('Contrato no encontrado'));
    }

    const { Inmueble, Inquilino } = await adjuntarPartesA(contrato);
    const inmueble = Inmueble as InmuebleAjeno | null;
    const arrendador = inmueble ? await usuarioPorId(inmueble.id_propietario) : null;

    if (!inmueble || !Inquilino || !arrendador) {
      return res.status(502).json(crearError('No se pudieron obtener los datos de las partes del contrato'));
    }

    datos = { contrato, inmueble, arrendador, arrendatario: Inquilino as Persona };
  } catch (error) {
    return responderServicioCaido(res, error, 'generar el documento del contrato');
  }

  try {
    const pdf = documentoContrato(datos);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contrato-${datos.contrato.id_contrato.slice(0, 8)}.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    pdf.pipe(res);
  } catch (error) {
    console.error('Error al generar el documento del contrato:', (error as Error).message);
    return res.status(500).json(crearError('Error al generar el documento del contrato'));
  }
};

/** POST /api/contratos */
export const crear = async (req: Request, res: Response): Promise<Response> => {
  let t = null;
  try {
    const sub = req.usuario?.sub as string;
    const cuerpo = req.body as Record<string, unknown>;
    const { id_inmueble, id_inquilino } = cuerpo;

    // 0. La forma, antes de consultar a ms-inmuebles.
    const { datos, errores } = validarContrato(cuerpo);
    if (errores.length) {
      return res.status(400).json(errorDeValidacion(errores));
    }

    // Las columnas de auditoria no se aceptan del cliente: las pone el hook.
    const { creado_por, actualizado_por, ...contratoData } = cuerpo;
    void creado_por;
    void actualizado_por;

    // 1. El inmueble tiene que ser del propietario autenticado. Si ms-inmuebles
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
    // `datos` va normalizado: deudor recortado, día límite y canon como números.
    const nuevoContrato = await Contrato.create({ ...contratoData, ...datos }, {
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

    // La fecha del último ajuste la pone el ajuste, nunca el cliente.
    const { creado_por, actualizado_por, fecha_ultimo_ajuste, ...cambios } = req.body as Record<string, unknown>;
    void creado_por;
    void actualizado_por;
    void fecha_ultimo_ajuste;

    const ajuste = ajusteDeCanon(contrato, hoyEnZonaNegocio(), IPC_ANUAL);
    const canonNuevo = Number(cambios['canon']);
    // El modal de edición envía siempre el canon: sólo cuenta si cambia.
    const esAjuste =
      contrato.estado === ESTADO_CONTRATO_ACTIVO &&
      ajuste?.en_ventana === true &&
      cambios['canon'] !== undefined &&
      canonNuevo !== Number(contrato.canon);

    if (!esAjuste) {
      await contrato.update(cambios, { usuarioAuditor: sub });
      return res.json({ mensaje: 'Contrato actualizado', contrato });
    }

    const tope = ajuste.canon_sugerido as number;
    if (!(canonNuevo > 0 && canonNuevo <= tope)) {
      return res.status(400).json(
        errorDeValidacion([
          {
            campo: 'canon',
            mensaje: `El canon debe ser positivo y no superar $${tope.toLocaleString('es-CO')}, el tope del IPC de ${ajuste.anio_ipc}`,
          },
        ]),
      );
    }

    const inmueble = await propioDe(contrato.id_inmueble, sub);
    const canonAnterior = Number(contrato.canon);

    // Con la ventana abierta, cambiar el canon es el ajuste anual: se guarda desde cuándo rige y se avisa al
    // inquilino. El siguiente cuenta desde `rige_desde` porque la ley pide 12 meses bajo un mismo precio.
    await sequelize.transaction(async (transaccion) => {
      await contrato.update(
        { ...cambios, fecha_ultimo_ajuste: ajuste.rige_desde },
        { transaction: transaccion, usuarioAuditor: sub },
      );
      await registrarCanonAjustado(
        {
          id_contrato: contrato.id_contrato,
          id_inquilino: contrato.id_inquilino,
          id_propietario: sub,
          direccion_inmueble: typeof inmueble?.['direccion'] === 'string' ? inmueble['direccion'] : 'Inmueble sin dirección registrada',
          canon_anterior: canonAnterior,
          canon_nuevo: canonNuevo,
          ipc: ajuste.ipc as number,
          anio_ipc: ajuste.anio_ipc,
          rige_desde: ajuste.rige_desde,
        },
        contrato.id_inmueble,
        transaccion,
      );
    });

    return res.json({ mensaje: 'Ajuste de canon aplicado', contrato, rige_desde: ajuste.rige_desde });
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
