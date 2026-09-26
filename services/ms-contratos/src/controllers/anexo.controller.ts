/**
 * Anexos de un contrato: subir, listar, descargar y borrar archivos PDF. La
 * pertenencia se resuelve en `services/pertenencia.ts`.
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { crearError } from 'arriendos360-shared';

import { esPdf } from '../middlewares/upload.middleware';
import { Anexo } from '../models/Anexo';
import { esUuid } from '../models/uuid';
import { CARPETA_ANEXOS, almacenamiento } from '../services/almacenamiento';
import { contratoDondeEsParte } from '../services/pertenencia';

/** Nombre del archivo que ve el usuario. El de origen no se guarda ni se usa. */
const nombreDescarga = (anexo: Anexo): string =>
  `${String(anexo.tipo).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${anexo.id_anexo.slice(0, 8)}.pdf`;

/** 502 cuando ms-inmuebles no responde. */
const responderServicioCaido = (res: Response, error: unknown, accion: string): Response => {
  console.error(`Error al ${accion}:`, (error as Error).message);
  return res.status(502).json(crearError('No se pudo contactar el servicio de inmuebles'));
};

/** 404 y no 403 cuando el contrato no es suyo, para no confirmar que existe. */
const NO_ENCONTRADO = { mensaje: 'Contrato no encontrado o no tienes permisos' };

/** POST /api/contratos/:id/anexos — `multipart/form-data` con `file` y `tipo`. */
export const subir = async (req: Request, res: Response): Promise<Response> => {
  let contrato;
  try {
    contrato = await contratoDondeEsParte(req.params['id'] as string, req.usuario?.sub as string);
  } catch (error) {
    return responderServicioCaido(res, error, 'verificar el contrato');
  }

  if (!contrato) {
    return res.status(404).json(NO_ENCONTRADO);
  }

  if (!req.file) {
    return res.status(400).json(crearError('Adjunta el archivo en el campo `file`'));
  }

  // Se valida por contenido: los primeros bytes.
  if (!esPdf(req.file.buffer)) {
    return res.status(400).json(crearError('El archivo no es un PDF'));
  }

  const tipo = typeof req.body?.tipo === 'string' ? req.body.tipo.trim() : '';
  if (tipo === '') {
    return res.status(400).json(crearError('Indica el `tipo` del anexo'));
  }

  try {
    // Primero el archivo y luego la fila: un fallo deja, como mucho, un archivo huérfano.
    const { referencia } = await almacenamiento().guardar({
      contenido: req.file.buffer,
      tipoMime: 'application/pdf',
      carpeta: `${CARPETA_ANEXOS}/${contrato.id_contrato}`,
      extension: '.pdf',
    });

    const anexo = await Anexo.create(
      {
        id_anexo: crypto.randomUUID(),
        archivo_anexo: referencia,
        tipo,
        id_contrato: contrato.id_contrato,
      },
      { usuarioAuditor: req.usuario?.sub },
    );

    return res.status(201).json({ mensaje: 'Anexo cargado', anexo });
  } catch (error) {
    console.error('Error al subir el anexo:', (error as Error).message);
    return res.status(500).json(crearError('No se pudo guardar el anexo'));
  }
};

/** GET /api/contratos/:id/anexos — sin `archivo_anexo`, que es interno. */
export const listar = async (req: Request, res: Response): Promise<Response> => {
  let contrato;
  try {
    contrato = await contratoDondeEsParte(req.params['id'] as string, req.usuario?.sub as string);
  } catch (error) {
    return responderServicioCaido(res, error, 'verificar el contrato');
  }

  if (!contrato) {
    return res.status(404).json(NO_ENCONTRADO);
  }

  const anexos = await Anexo.findAll({
    where: { id_contrato: contrato.id_contrato },
    attributes: ['id_anexo', 'tipo', 'id_contrato', 'fecha_creacion', 'creado_por'],
    order: [['fecha_creacion', 'ASC']],
  });

  return res.json(anexos);
};

/** GET /api/contratos/:id/anexos/:idAnexo — descarga en streaming, como adjunto. */
export const descargar = async (req: Request, res: Response): Promise<Response | void> => {
  let contrato;
  try {
    contrato = await contratoDondeEsParte(req.params['id'] as string, req.usuario?.sub as string);
  } catch (error) {
    return responderServicioCaido(res, error, 'verificar el contrato');
  }

  if (!contrato) {
    return res.status(404).json(NO_ENCONTRADO);
  }

  const idAnexo = req.params['idAnexo'];

  // El anexo tiene que ser de este contrato.
  const anexo = esUuid(idAnexo)
    ? await Anexo.findOne({
        where: { id_anexo: idAnexo, id_contrato: contrato.id_contrato },
      })
    : null;

  if (!anexo) {
    return res.status(404).json(crearError('Anexo no encontrado'));
  }

  let archivo;
  try {
    archivo = await almacenamiento().leer(anexo.archivo_anexo);
  } catch (error) {
    console.error('Error al leer el anexo del almacenamiento:', (error as Error).message);
    return res.status(500).json(crearError('No se pudo leer el anexo'));
  }

  if (!archivo) {
    // La fila existe pero el archivo no.
    console.error(`Anexo ${anexo.id_anexo} sin archivo en ${anexo.archivo_anexo}`);
    return res.status(404).json(crearError('El archivo del anexo ya no está disponible'));
  }

  res.setHeader('Content-Type', archivo.tipoMime);
  res.setHeader('Content-Length', archivo.tamano);
  res.setHeader('Content-Disposition', `attachment; filename="${nombreDescarga(anexo)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  archivo.flujo.on('error', (error: Error) => {
    console.error('Error al transmitir el anexo:', error.message);
    // Con las cabeceras ya enviadas, sólo queda cortar la conexión.
    res.destroy(error);
  });

  archivo.flujo.pipe(res);
  return undefined;
};

/**
 * DELETE /api/contratos/:id/anexos/:idAnexo — borra la fila y después el archivo.
 */
export const eliminar = async (req: Request, res: Response): Promise<Response> => {
  let contrato;
  try {
    contrato = await contratoDondeEsParte(req.params['id'] as string, req.usuario?.sub as string);
  } catch (error) {
    return responderServicioCaido(res, error, 'verificar el contrato');
  }

  if (!contrato) {
    return res.status(404).json(NO_ENCONTRADO);
  }

  const idAnexo = req.params['idAnexo'];
  const anexo = esUuid(idAnexo)
    ? await Anexo.findOne({
        where: { id_anexo: idAnexo, id_contrato: contrato.id_contrato },
      })
    : null;

  if (!anexo) {
    return res.status(404).json(crearError('Anexo no encontrado'));
  }

  const referencia = anexo.archivo_anexo;
  await anexo.destroy();

  try {
    await almacenamiento().eliminar(referencia);
  } catch (error) {
    // Queda en el log para limpiarlo a mano.
    console.error(`No se pudo borrar el archivo ${referencia}:`, (error as Error).message);
  }

  return res.json({ mensaje: 'Anexo eliminado' });
};
