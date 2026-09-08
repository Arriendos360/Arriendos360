/**
 * Recepcion de archivos subidos.
 *
 * Viene del gateway con el paso 6d, sin cambios de diseño: los anexos son de
 * este servicio y su multipart tambien. Lo unico nuevo es el tipado.
 *
 * El archivo llega a MEMORIA y el controlador se lo pasa al almacenamiento. Con
 * el tope de 10 MB, tenerlo en memoria un instante es asumible y es lo que
 * permite mirarle los primeros bytes ANTES de guardarlo: lo que no se ha escrito
 * no hay que borrarlo si resulta que no era un PDF.
 */

import type { NextFunction, Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { ESTADO_VALIDACION } from 'arriendos360-shared';

/**
 * Tope por archivo: 10 MB.
 *
 * Un contrato de arriendo escaneado son entre 5 y 15 paginas. A 300 ppp en
 * escala de grises —lo que sale de una multifuncion de oficina— cada pagina
 * ronda los 300 KB, asi que 10 MB dan para unas treinta. Suficiente con margen
 * para un contrato con anexos y prorrogas.
 *
 * El tope no es cosmetico: sin el, un solo archivo puede llenar el disco o
 * agotar la memoria del contenedor, y en Container Apps eso tira la replica.
 */
export const TAMANO_MAXIMO_MB = 10;
export const TAMANO_MAXIMO_BYTES = TAMANO_MAXIMO_MB * 1024 * 1024;

/** Los primeros bytes de todo PDF: `%PDF-`. */
export const FIRMA_PDF = Buffer.from('%PDF-', 'ascii');

/**
 * ¿Es esto un PDF de verdad?
 *
 * MIRA EL CONTENIDO, no el nombre ni lo que declare el cliente. La extension la
 * pone quien sube el archivo y el `Content-Type` del multipart tambien: las dos
 * son afirmaciones suyas, no comprobaciones. Renombrar `virus.exe` a
 * `contrato.pdf` y declararlo `application/pdf` es todo lo que hacia falta para
 * pasar el filtro anterior.
 *
 * La firma `%PDF-` en los primeros cinco bytes es lo que exige la especificacion
 * del formato. No garantiza que el PDF sea valido de principio a fin —para eso
 * habria que parsearlo entero— pero si que no es un ejecutable ni un ZIP con
 * otro nombre, que es lo que importa aqui.
 */
export const esPdf = (buffer: unknown): boolean =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= FIRMA_PDF.length &&
  buffer.subarray(0, FIRMA_PDF.length).equals(FIRMA_PDF);

/**
 * Multer en memoria.
 *
 * El `fileFilter` sigue mirando el `mimetype` declarado, y no sobra aunque no se
 * pueda confiar en el: corta pronto y barato el caso honesto —alguien que elige
 * un JPG por error— sin llegar a leer el archivo entero. El caso deshonesto lo
 * ataja `esPdf` despues. Son dos barreras para dos cosas distintas.
 */
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

/**
 * Traduce los errores de multer a respuestas del proyecto.
 *
 * Sin esto, un archivo demasiado grande sale por el manejador de errores de
 * Express como un 500 generico, y el usuario no se entera de que el problema es
 * el tamaño y no el servidor.
 *
 * **413 y no 400** para el tope: el codigo existe exactamente para esto
 * («Content Too Large») y le dice al cliente que el problema es el tamaño de lo
 * que mando, no su contenido. Un 400 lo dejaria adivinando.
 */
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

/**
 * Recibe UN archivo en el campo `file`, con los errores ya traducidos.
 *
 * Se exporta montado y no en piezas para que no haya forma de poner el `single`
 * sin su manejador: es el orden lo que hace que el 413 llegue al usuario.
 */
export const recibirArchivo = (campo = 'file'): RequestHandler[] => [
  upload.single(campo),
  manejarErroresDeSubida as unknown as RequestHandler,
];
