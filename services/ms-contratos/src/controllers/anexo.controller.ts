/**
 * Anexos de un contrato.
 *
 * EL FLUJO ES DE DOS PASOS, y el Capitulo 2 es explicito al respecto: el anexo
 * no nace con el contrato. Primero se firma —y asi existe un `id_contrato`— y
 * despues se adjunta. Eso permite varios archivos por contrato, con su tipo, en
 * vez del unico `url_pdf` que habia.
 *
 * ── LA AUTORIZACION YA NO SE ESCRIBE AQUI ───────────────────────────────────
 *
 * En el gateway este archivo tenia su propia `contratoAccesible()`, con la
 * disyuncion completa y el orden de evaluacion invertido para ahorrar una
 * llamada de red. Era una de las cuatro copias de la misma pregunta repartidas
 * por el proyecto. Ahora esta en `services/pertenencia.ts` y aqui solo se llama,
 * asi que el orden de evaluacion —primero el inquilino, que es local; despues el
 * propietario, que cuesta un salto— se decide una vez y vale para todos.
 *
 * ── Y LA CABECERA VIEJA RECOMENDABA ALGO QUE NO SE HIZO ─────────────────────
 *
 * Proponia denormalizar `id_propietario` en `Contratos` para que los dos caminos
 * del ABAC quedaran locales. Se decidio que no: el dueño de un inmueble puede
 * cambiar y una copia vieja daria acceso a quien ya no lo es. Ver
 * `docs/adr/0017`.
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

/** 502 con el formato del proyecto. Un servicio caido no es un 500 nuestro. */
const responderServicioCaido = (res: Response, error: unknown, accion: string): Response => {
  console.error(`Error al ${accion}:`, (error as Error).message);
  return res.status(502).json(crearError('No se pudo contactar el servicio de inmuebles'));
};

/**
 * 404 y no 403 cuando el contrato no es suyo.
 *
 * Un 403 confirmaria que ese identificador existe, que es informacion que quien
 * pregunta no tiene por que obtener probando UUID.
 */
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

  // La comprobacion que de verdad decide: los primeros bytes del archivo. El
  // `mimetype` que trae el multipart ya lo miro el middleware, pero lo declara
  // quien sube, asi que no prueba nada por si solo.
  if (!esPdf(req.file.buffer)) {
    return res.status(400).json(crearError('El archivo no es un PDF'));
  }

  const tipo = typeof req.body?.tipo === 'string' ? req.body.tipo.trim() : '';
  if (tipo === '') {
    return res.status(400).json(crearError('Indica el `tipo` del anexo'));
  }

  try {
    // Se guarda el archivo ANTES que la fila. Si falla el almacenamiento no
    // queda una fila apuntando a nada; al reves, un fallo de la base dejaria un
    // archivo huerfano, que es mas barato de tolerar — ocupa espacio y no engaña
    // a nadie, mientras que una fila rota sale por pantalla como un anexo que
    // existe y no se puede descargar.
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

/**
 * GET /api/contratos/:id/anexos
 *
 * No devuelve `archivo_anexo`: es una referencia interna del almacenamiento y no
 * le sirve de nada al cliente, que descarga por `id_anexo`. Publicarla solo
 * daria pistas sobre como estan guardados los archivos.
 */
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

/**
 * GET /api/contratos/:id/anexos/:idAnexo
 *
 * EN STREAMING. El archivo no pasa entero por la memoria del servicio: se pide
 * al almacenamiento un flujo y se conecta a la respuesta. Diez descargas
 * simultaneas de un contrato escaneado de 10 MB serian 100 MB de memoria si se
 * cargaran enteros, en un contenedor que no los tiene.
 *
 * NADA DE URL FIRMADAS ni de acceso publico. Cada descarga pasa por la matriz
 * RBAC del gateway y por el ABAC de aqui, asi que dejar de ser parte del
 * contrato corta el acceso de inmediato.
 */
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

  // El anexo tiene que ser DE ESTE CONTRATO. Sin esta condicion, quien tenga un
  // contrato propio podria descargar cualquier anexo del sistema poniendo su id
  // en la URL: el ABAC de arriba habria dicho que si al contrato, y el anexo
  // vendria de otro.
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
    // La fila existe y el archivo no. Pasa si alguien borro el disco por debajo,
    // que es exactamente lo que ocurria al reiniciar el contenedor antes del
    // paso 6b. Se dice, en vez de devolver una respuesta vacia.
    console.error(`Anexo ${anexo.id_anexo} sin archivo en ${anexo.archivo_anexo}`);
    return res.status(404).json(crearError('El archivo del anexo ya no está disponible'));
  }

  res.setHeader('Content-Type', archivo.tipoMime);
  res.setHeader('Content-Length', archivo.tamano);
  // `attachment` y no `inline`: es contenido que sube un usuario y se lo descarga
  // otro. El frontend lo recibe como blob y decide que hacer con el.
  res.setHeader('Content-Disposition', `attachment; filename="${nombreDescarga(anexo)}"`);
  // Que el navegador no intente adivinar otro tipo mirando el contenido.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  archivo.flujo.on('error', (error: Error) => {
    console.error('Error al transmitir el anexo:', error.message);
    // Las cabeceras ya salieron: no se puede responder un codigo de error, solo
    // cortar para que el cliente vea una descarga incompleta en vez de un
    // archivo truncado que parezca bueno.
    res.destroy(error);
  });

  archivo.flujo.pipe(res);
  return undefined;
};

/**
 * DELETE /api/contratos/:id/anexos/:idAnexo
 *
 * Solo el propietario, por la matriz del gateway y por `esPropietario` aqui. Se
 * borra la fila y el archivo, en ese orden: si falla el almacenamiento queda un
 * archivo huerfano y no una fila que no se puede descargar.
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
    // No se propaga: la fila ya no esta y el usuario no puede hacer nada con
    // este error. Queda en el log para que se pueda limpiar a mano.
    console.error(`No se pudo borrar el archivo ${referencia}:`, (error as Error).message);
  }

  return res.json({ mensaje: 'Anexo eliminado' });
};
