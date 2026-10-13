/**
 * Contratos. Las respuestas salen compuestas con `Inquilino` e `Inmueble`
 * (`services/composicion.ts`) y la autorización pasa por `services/pertenencia.ts`.
 */

import type { Request, Response } from 'express';
import { ajusteDeCanon, crearError, hoyEnZonaNegocio, soloFecha } from 'arriendos360-shared';
import {
  CAMPOS_CONTRATO_EDITABLES,
  IPC_ANUAL,
  MESES_PREAVISO_TERMINACION,
  errorDeValidacion,
  validarCancelacion,
  validarContrato,
} from 'arriendos360-contracts';

import { reemitirContrasenaTemporal, usuarioPorId } from '../clientes/identidad';
import { propioDe } from '../clientes/inmuebles';
import type { InmuebleAjeno } from '../clientes/inmuebles';
import { sequelize } from '../config/database';
import {
  registrarCanonAjustado,
  registrarContratoFinalizado,
  registrarContratoFormalizado,
  registrarPreavisoEnviado,
} from '../eventos';
import { Contrato } from '../models/Contrato';
import { HistorialContrato } from '../models/HistorialContrato';
import {
  ESTADO_CONTRATO_ACTIVO,
  ESTADO_CONTRATO_CANCELADO,
  ESTADO_CONTRATO_FINALIZADO,
} from '../models/constantes';
import { esUuid } from '../models/uuid';
import {
  adjuntarPartes,
  adjuntarPartesA,
  causalesDelArrendador,
  conAjusteCanon,
  conPreaviso,
  parteQueAvisa,
  preavisoHoy,
  situacionDe,
} from '../services/composicion';
import { documentoContrato } from '../services/documentoContrato';
import type { DatosContrato, Persona } from '../services/documentoContrato';
import { documentoPreaviso } from '../services/documentoPreaviso';
import type { DatosPreaviso } from '../services/documentoPreaviso';
import { registrarCambios } from '../services/historial';
import type { ExtraCancelacion } from '../services/historial';
import {
  contratoDondeEsParte,
  contratoPropio,
  contratosDondeEsParte,
} from '../services/pertenencia';

/** El rol que tiene que tener el inquilino de un contrato. */
const ROL_INQUILINO = 'INQUILINO';

/** Columnas que pone el servidor, nunca el cliente: la auditoría, el ajuste y la constancia del preaviso. */
const COLUMNAS_DEL_SISTEMA = new Set([
  'creado_por',
  'actualizado_por',
  'fecha_ultimo_ajuste',
  'preaviso_enviado_en',
  'preaviso_enviado_por',
  'preaviso_vencimiento',
  'preaviso_causal',
]);

const sinColumnasDelSistema = (cuerpo: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(cuerpo).filter(([columna]) => !COLUMNAS_DEL_SISTEMA.has(columna)));

const EDITABLES: readonly string[] = CAMPOS_CONTRATO_EDITABLES;

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
    return res.json(contratos.map((contrato) => conPreaviso(conAjusteCanon(contrato, sub), sub)));
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

    return res.json(conPreaviso(conAjusteCanon(await adjuntarPartesA(contrato), sub), sub));
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener contrato');
  }
};

/** GET /api/contratos/:id/historial — los cambios del contrato, el más reciente primero, para las dos partes. */
export const historial = async (req: Request, res: Response): Promise<Response> => {
  try {
    const contrato = await contratoDondeEsParte(req.params['id'] as string, req.usuario?.sub as string);

    if (!contrato) {
      return res.status(404).json(crearError('Contrato no encontrado'));
    }

    return res.json(
      await HistorialContrato.findAll({
        where: { id_contrato: contrato.id_contrato },
        order: [['cambiado_en', 'DESC']],
      }),
    );
  } catch (error) {
    return responderServicioCaido(res, error, 'obtener el historial del contrato');
  }
};

/** El inmueble y las dos partes, o `null` si falta alguna: un documento a medias no sirve. */
const partesCompletas = async (
  contrato: Contrato,
): Promise<{ inmueble: InmuebleAjeno; arrendador: Persona; arrendatario: Persona } | null> => {
  const { Inmueble, Inquilino } = await adjuntarPartesA(contrato);
  const inmueble = Inmueble as InmuebleAjeno | null;
  const arrendador = inmueble ? await usuarioPorId(inmueble.id_propietario) : null;

  return inmueble && Inquilino && arrendador ? { inmueble, arrendador, arrendatario: Inquilino as Persona } : null;
};

const responderPartesIncompletas = (res: Response): Response =>
  res.status(502).json(crearError('No se pudieron obtener los datos de las partes del contrato'));

/** Arma el PDF y lo envía como adjunto; 500 si no se pudo armar. */
const responderPdf = (res: Response, archivo: string, armar: () => PDFKit.PDFDocument, accion: string): Response | void => {
  try {
    const pdf = armar();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    pdf.pipe(res);
  } catch (error) {
    console.error(`Error al ${accion}:`, (error as Error).message);
    return res.status(500).json(crearError(`Error al ${accion}`));
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

    const partes = await partesCompletas(contrato);
    if (!partes) {
      return responderPartesIncompletas(res);
    }

    datos = { contrato, ...partes };
  } catch (error) {
    return responderServicioCaido(res, error, 'generar el documento del contrato');
  }

  return responderPdf(
    res,
    `contrato-${datos.contrato.id_contrato.slice(0, 8)}.pdf`,
    () => documentoContrato(datos),
    'generar el documento del contrato',
  );
};

/** GET /api/contratos/:id/preaviso — la carta del preaviso registrado en PDF, para las dos partes. */
export const cartaPreaviso = async (req: Request, res: Response): Promise<Response | void> => {
  let datos: DatosPreaviso;
  try {
    const contrato = await contratoDondeEsParte(req.params['id'] as string, req.usuario?.sub as string);

    if (!contrato) {
      return res.status(404).json(crearError('Contrato no encontrado'));
    }
    if (!contrato.preaviso_enviado_en) {
      return res.status(404).json(crearError('El contrato no tiene un preaviso registrado'));
    }

    const partes = await partesCompletas(contrato);
    if (!partes) {
      return responderPartesIncompletas(res);
    }

    const parte = parteQueAvisa(contrato);
    const { arrendador, arrendatario } = partes;
    datos = {
      contrato,
      parte,
      inmueble: partes.inmueble,
      remitente: parte === 'INQUILINO' ? arrendatario : arrendador,
      destinatario: parte === 'INQUILINO' ? arrendador : arrendatario,
    };
  } catch (error) {
    return responderServicioCaido(res, error, 'generar la carta de preaviso');
  }

  return responderPdf(
    res,
    `preaviso-${datos.contrato.id_contrato.slice(0, 8)}.pdf`,
    () => documentoPreaviso(datos),
    'generar la carta de preaviso',
  );
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

    const contratoData = sinColumnasDelSistema(cuerpo);

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
    const cambios = (req.body ?? {}) as Record<string, unknown>;

    // Sólo los editables: el estado tiene sus endpoints, y las partes, el inicio y el corte no cambian.
    const ajenos = Object.keys(cambios).filter((campo) => !EDITABLES.includes(campo));
    if (ajenos.length > 0) {
      return res
        .status(400)
        .json(errorDeValidacion(ajenos.map((campo) => ({ campo, mensaje: `El campo ${campo} no se puede editar` }))));
    }

    const contrato = await contratoPropio(req.params['id'] as string, sub);

    if (!contrato) {
      return res
        .status(404)
        .json(crearError('Contrato no encontrado o no tienes permisos'));
    }
    if (contrato.estado !== ESTADO_CONTRATO_ACTIVO) {
      return res.status(409).json(crearError('Sólo se puede editar un contrato activo'));
    }

    const hoy = hoyEnZonaNegocio();
    const finActual = soloFecha(contrato.fin) as string;
    // `fin` mide el término que se prorroga: sólo se corrige mientras corre y sin preaviso.
    if ('fin' in cambios && soloFecha(cambios['fin']) !== finActual) {
      if (hoy > finActual || contrato.preaviso_enviado_en) {
        return res
          .status(409)
          .json(crearError('La fecha de fin sólo se cambia durante el término inicial y sin preaviso'));
      }
      const finNuevo = soloFecha(cambios['fin']);
      if (finNuevo === null || finNuevo <= hoy || finNuevo <= (soloFecha(contrato.inicio) as string)) {
        return res
          .status(400)
          .json(errorDeValidacion([{ campo: 'fin', mensaje: 'La fecha de fin debe ser posterior a hoy y al inicio' }]));
      }
    }

    const ajuste = ajusteDeCanon(contrato, hoy, IPC_ANUAL);
    const canonNuevo = Number(cambios['canon']);
    // El modal de edición envía siempre el canon: sólo cuenta si cambia.
    const esAjuste =
      ajuste?.en_ventana === true &&
      cambios['canon'] !== undefined &&
      canonNuevo !== Number(contrato.canon);

    if (!esAjuste) {
      await sequelize.transaction(async (transaccion) => {
        await registrarCambios(contrato, cambios, sub, transaccion);
        await contrato.update(cambios, { transaction: transaccion, usuarioAuditor: sub });
      });
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
      await registrarCambios(contrato, cambios, sub, transaccion);
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

/**
 * POST /api/contratos/:id/preaviso — una de las partes avisa que no renovará el contrato al
 * vencimiento vigente. Una sola vez por contrato y hasta la fecha límite.
 */
export const enviarPreaviso = async (req: Request, res: Response): Promise<Response> => {
  try {
    const sub = req.usuario?.sub as string;
    const contrato = await contratoDondeEsParte(req.params['id'] as string, sub);

    if (!contrato) {
      return res.status(404).json(crearError('Contrato no encontrado'));
    }
    if (contrato.estado !== ESTADO_CONTRATO_ACTIVO) {
      return res.status(409).json(crearError('Sólo se puede enviar el preaviso de un contrato activo'));
    }
    if (contrato.preaviso_enviado_en) {
      return res.status(409).json(crearError('Ya se envió el preaviso de este contrato'));
    }

    const preaviso = preavisoHoy(contrato);
    if (!preaviso?.dentro_de_plazo) {
      return res.status(409).json(
        crearError(
          `El plazo del preaviso venció el ${preaviso?.fecha_limite}, ${MESES_PREAVISO_TERMINACION} meses antes del vencimiento del ${preaviso?.vencimiento}`,
        ),
      );
    }

    const esInquilino = contrato.id_inquilino === sub;
    const causal = esInquilino ? null : (req.body as Record<string, unknown>)['causal'];
    if (!esInquilino) {
      const disponibles = causalesDelArrendador(contrato.inicio, preaviso.vencimiento);
      if (!disponibles.includes(causal as never)) {
        return res
          .status(400)
          .json(errorDeValidacion([{ campo: 'causal', mensaje: `La causal debe ser una de: ${disponibles.join(', ')}` }]));
      }
    }

    const { Inmueble, Inquilino } = await adjuntarPartesA(contrato);
    const inmueble = Inmueble as InmuebleAjeno | null;
    // Sin el dueño no hay a quién avisar: no se registra un preaviso que nadie recibiría.
    if (!inmueble) {
      return res.status(502).json(crearError('No se pudo contactar el servicio de inmuebles'));
    }

    const enviadoEn = new Date();
    await sequelize.transaction(async (transaccion) => {
      await contrato.update(
        {
          preaviso_enviado_en: enviadoEn,
          preaviso_enviado_por: sub,
          preaviso_vencimiento: preaviso.vencimiento,
          preaviso_causal: causal,
        },
        { transaction: transaccion, usuarioAuditor: sub },
      );
      await registrarPreavisoEnviado(
        {
          id_contrato: contrato.id_contrato,
          id_inquilino: contrato.id_inquilino,
          id_propietario: inmueble.id_propietario,
          parte: esInquilino ? 'INQUILINO' : 'PROPIETARIO',
          direccion_inmueble: typeof inmueble['direccion'] === 'string' ? inmueble['direccion'] : 'Inmueble sin dirección registrada',
          vencimiento: preaviso.vencimiento,
          causal: causal as string | null,
          enviado_en: enviadoEn.toISOString(),
        },
        contrato.id_inmueble,
        transaccion,
      );
    });

    return res.status(201).json({
      mensaje: 'Preaviso registrado',
      contrato: conPreaviso({ ...(contrato.toJSON() as Record<string, unknown>), Inmueble, Inquilino }, sub),
    });
  } catch (error) {
    return responderServicioCaido(res, error, 'enviar el preaviso');
  }
};

/** La condición propia de cada terminación: un rechazo, o lo que el historial guarda además. */
type Admision = { rechazo: [estado: number, cuerpo: object] } | { extra?: ExtraCancelacion };

/**
 * Lleva un contrato propio y activo a un estado terminal. El estado, su fila de historial y
 * `ContratoFinalizado`, que libera el inmueble y para la facturación, van en una transacción.
 */
const terminar = async (
  req: Request,
  res: Response,
  estado: string,
  admite: (contrato: Contrato) => Admision,
): Promise<Response> => {
  const sub = req.usuario?.sub as string;
  let contrato: Contrato | null;
  try {
    contrato = await contratoPropio(req.params['id'] as string, sub);
  } catch (error) {
    return responderServicioCaido(res, error, 'verificar el contrato');
  }

  if (!contrato) {
    return res.status(404).json(crearError('Contrato no encontrado o no tienes permisos'));
  }
  if (contrato.estado !== ESTADO_CONTRATO_ACTIVO) {
    return res.status(409).json(crearError('Sólo se puede terminar un contrato activo'));
  }

  const admision = admite(contrato);
  if ('rechazo' in admision) {
    return res.status(admision.rechazo[0]).json(admision.rechazo[1]);
  }

  try {
    const terminado = contrato;
    await sequelize.transaction(async (transaccion) => {
      await registrarCambios(terminado, { estado }, sub, transaccion, admision.extra);
      await terminado.update({ estado }, { transaction: transaccion, usuarioAuditor: sub });
      // Cancelar también lo emite: lo que ms-inmuebles necesita saber es que el contrato terminó.
      await registrarContratoFinalizado(terminado, transaccion);
    });
  } catch (error) {
    console.error(`Error al dejar el contrato en ${estado}:`, (error as Error).message);
    return res.status(500).json(crearError('Error al terminar el contrato'));
  }

  return res.json({ mensaje: `Contrato ${estado}`, contrato });
};

/** PUT /api/contratos/:id/finalizar — el contrato no se renovó: sólo con un preaviso vencido. */
export const finalizar = (req: Request, res: Response): Promise<Response> =>
  terminar(req, res, ESTADO_CONTRATO_FINALIZADO, (contrato): Admision =>
    situacionDe(contrato) === 'vencido_con_preaviso'
      ? {}
      : { rechazo: [409, crearError('Un contrato sin preaviso vencido no se finaliza: cancélalo')] },
  );

/**
 * PUT /api/contratos/:id/cancelar — terminación antes de tiempo, con su motivo y la indemnización
 * pactada. El servidor valida la forma, no el valor sugerido.
 */
export const cancelar = (req: Request, res: Response): Promise<Response> =>
  terminar(req, res, ESTADO_CONTRATO_CANCELADO, (contrato): Admision => {
    const { datos, errores } = validarCancelacion(req.body, { situacion: situacionDe(contrato) });
    if (errores.length > 0) {
      return { rechazo: [400, errorDeValidacion(errores)] };
    }
    return {
      extra: {
        motivo: datos.motivo as string,
        indemnizacion: datos.indemnizacion as number,
        indemnizacion_a_cargo_de: datos.indemnizacion_a_cargo_de ?? null,
      },
    };
  });

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
