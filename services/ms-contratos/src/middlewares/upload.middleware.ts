/**
 * Recepción de archivos subidos, en memoria, para poder validar sus primeros
 * bytes antes de guardarlos.
 */

import type { NextFunction, Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { ESTADO_VALIDACION } from 'arriendos360-shared';

/** Tope por archivo. */
export const TAMANO_MAXIMO_MB = 10;
export const TAMANO_MAXIMO_BYTES = TAMANO_MAXIMO_MB * 1024 * 1024;

/** Los primeros bytes de todo PDF: `%PDF-`. */
export const FIRMA_PDF = Buffer.from('%PDF-', 'ascii');

/** ¿Es un PDF? Se decide por la firma del contenido, no por el nombre ni el tipo declarado. */
export const esPdf = (buffer: unknown): boolean =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= FIRMA_PDF.length &&
  buffer.subarray(0, FIRMA_PDF.length).equals(FIRMA_PDF);

/** Multer en memoria. El `fileFilter` descarta pronto lo que no se declara PDF. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      return cb(null, true);
    }
    return cb(new multer.MulterError('LIMITE_TIPO_ARCHIVO' as never, file.fieldname));
  },
});

/** Traduce los errores de multer: 413 si excede el tope, 400 en lo demás. */
export const manejarErroresDeSubida = (
  error: unknown,
  _req: Request,
  res: Response,
  siguiente: NextFunction,
): Response | void => {
  if (!(error instanceof multer.MulterError)) {
    return siguiente(error);
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      mensaje: `El archivo supera el máximo de ${TAMANO_MAXIMO_MB} MB`,
    });
  }

  if ((error.code as string) === 'LIMITE_TIPO_ARCHIVO') {
    return res.status(ESTADO_VALIDACION).json({ mensaje: 'Solo se permiten archivos PDF' });
  }

  return res.status(ESTADO_VALIDACION).json({ mensaje: 'No se pudo procesar el archivo' });
};

/** Recibe un archivo en el campo `file`, con su manejador de errores detrás. */
export const recibirArchivo = (campo = 'file'): RequestHandler[] => [
  upload.single(campo),
  manejarErroresDeSubida as unknown as RequestHandler,
];
