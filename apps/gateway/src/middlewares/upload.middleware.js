/**
 * Recepción de archivos subidos.
 *
 * CAMBIÓ ENTERO EN EL PASO 6b. Antes esto escribía directamente en
 * `uploads/contratos/` con `multer.diskStorage`, y de ahí salía la ruta que se
 * guardaba en `contratos.url_pdf`. Dos cosas mal en una: el archivo quedaba en
 * el disco del contenedor —que no sobrevive a scale-to-zero— y el middleware
 * decidía DÓNDE se guarda, que es justamente lo que ahora decide el
 * almacenamiento detrás de su interfaz.
 *
 * Ahora el archivo llega a memoria y el controlador se lo pasa al
 * almacenamiento. Con el tope de 10 MB, tener el archivo en memoria un instante
 * es asumible y es lo que permite mirarle los primeros bytes ANTES de guardarlo:
 * lo que no se ha escrito no hay que borrarlo si resulta que no era un PDF.
 */

const multer = require('multer');

const { ESTADO_VALIDACION } = require('arriendos360-shared');

/**
 * Tope por archivo: 10 MB.
 *
 * Un contrato de arriendo escaneado son entre 5 y 15 páginas. A 300 ppp en
 * escala de grises —lo que sale de una multifunción de oficina— cada página
 * ronda los 300 KB, así que 10 MB dan para unas treinta. Suficiente con margen
 * para un contrato con anexos y prórrogas.
 *
 * El tope no es cosmético: sin él, un solo archivo puede llenar el disco o
 * agotar la memoria del contenedor, y en Container Apps eso tira la réplica.
 */
const TAMANO_MAXIMO_MB = 10;
const TAMANO_MAXIMO_BYTES = TAMANO_MAXIMO_MB * 1024 * 1024;

/** Los primeros bytes de todo PDF: `%PDF-`. */
const FIRMA_PDF = Buffer.from('%PDF-', 'ascii');

/**
 * ¿Es esto un PDF de verdad?
 *
 * MIRA EL CONTENIDO, no el nombre ni lo que declare el cliente. La extensión la
 * pone quien sube el archivo y el `Content-Type` del multipart también: las dos
 * son afirmaciones suyas, no comprobaciones. Renombrar `virus.exe` a
 * `contrato.pdf` y declararlo `application/pdf` es todo lo que hacía falta para
 * pasar el filtro anterior.
 *
 * La firma `%PDF-` en los primeros cinco bytes es lo que exige la especificación
 * del formato. No garantiza que el PDF sea válido de principio a fin —para eso
 * habría que parsearlo entero— pero sí que no es un ejecutable ni un ZIP con
 * otro nombre, que es lo que importa aquí.
 */
const esPdf = (buffer) =>
    Buffer.isBuffer(buffer) &&
    buffer.length >= FIRMA_PDF.length &&
    buffer.subarray(0, FIRMA_PDF.length).equals(FIRMA_PDF);

/**
 * Multer en memoria.
 *
 * El `fileFilter` sigue mirando el `mimetype` declarado, y no sobra aunque no se
 * pueda confiar en él: corta pronto y barato el caso honesto —alguien que elige
 * un JPG por error— sin llegar a leer el archivo entero. El caso deshonesto lo
 * ataja `esPdf` después. Son dos barreras para dos cosas distintas.
 */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            return cb(null, true);
        }
        return cb(new multer.MulterError('LIMITE_TIPO_ARCHIVO', file.fieldname));
    }
});

/**
 * Traduce los errores de multer a respuestas del proyecto.
 *
 * Sin esto, un archivo demasiado grande sale por el manejador de errores de
 * Express como un 500 genérico, y el usuario no se entera de que el problema es
 * el tamaño y no el servidor.
 *
 * **413 y no 400** para el tope: el código existe exactamente para esto
 * («Content Too Large») y le dice al cliente que el problema es el tamaño de lo
 * que mandó, no su contenido. Un 400 lo dejaría adivinando.
 */
const manejarErroresDeSubida = (error, req, res, siguiente) => {
    if (!(error instanceof multer.MulterError)) {
        return siguiente(error);
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            mensaje: `El archivo supera el máximo de ${TAMANO_MAXIMO_MB} MB`
        });
    }

    if (error.code === 'LIMITE_TIPO_ARCHIVO') {
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
const recibirArchivo = (campo = 'file') => [upload.single(campo), manejarErroresDeSubida];

module.exports = {
    FIRMA_PDF,
    TAMANO_MAXIMO_BYTES,
    TAMANO_MAXIMO_MB,
    esPdf,
    manejarErroresDeSubida,
    recibirArchivo,
    upload
};
