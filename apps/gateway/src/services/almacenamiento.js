/**
 * Almacenamiento de archivos.
 *
 * MISMA JUGADA QUE `Notificador` en ms-identidad, y por la misma razón: hay una
 * cosa que el código necesita hacer hoy, un sitio distinto donde tendrá que
 * hacerla mañana, y ninguna de las dos debe filtrarse a la lógica de negocio.
 * El controlador de anexos no sabe si el archivo acaba en un disco o en un
 * contenedor de Azure; le pide al almacenamiento que lo guarde y se queda con la
 * referencia que le devuelvan.
 *
 * DOS IMPLEMENTACIONES, Y LAS DOS HACEN FALTA.
 *
 * - `AlmacenamientoDisco` es la de desarrollo y la de las pruebas. Que exista es
 *   lo que permite que las suites sigan corriendo en un portátil sin Docker y
 *   sin credenciales de Azure, que es la regla que CLAUDE.md fija para todo el
 *   proyecto. No es un doble: es una implementación de verdad, con sus pruebas.
 * - `AlmacenamientoAzureBlob` es la de despliegue. Cierra la decisión abierta
 *   que CLAUDE.md tenía anotada —«hoy los archivos van a disco local, que no
 *   sobrevive a scale-to-zero»— porque en Container Apps el disco del
 *   contenedor se borra cada vez que la réplica se apaga. Ver `docs/adr/0014`.
 *
 * LA REFERENCIA ES OPACA. `archivo_anexo` guarda lo que devuelve `guardar()`, y
 * lo único que se promete de ese valor es que `leer()` y `eliminar()` lo
 * entienden. Con disco es una ruta relativa a la raíz configurada; con Azure, el
 * nombre del blob. Guardar una ruta absoluta de disco —lo que hacía `url_pdf`—
 * ata la fila a la máquina que la escribió.
 *
 * LEER DEVUELVE UN FLUJO, no un Buffer. Un contrato escaneado de 10 MB por diez
 * descargas simultáneas son 100 MB de memoria en un contenedor que tiene poco
 * más; en streaming son unos pocos kilobytes de búfer. Y es lo que permite que
 * el usuario empiece a ver el PDF antes de que termine de bajar.
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/** Carpeta lógica donde viven los anexos dentro del almacenamiento. */
const CARPETA_ANEXOS = 'contratos';

/**
 * Contrato que cumplen las dos implementaciones.
 *
 * Se declara como clase con métodos que lanzan, y no como comentario suelto,
 * para que una implementación incompleta falle al usarse y no en silencio.
 *
 * @typedef {object} ArchivoGuardado
 * @property {string} referencia  lo que se guarda en `archivo_anexo`
 * @property {number} tamano      bytes
 *
 * @typedef {object} ArchivoLeido
 * @property {NodeJS.ReadableStream} flujo
 * @property {number} tamano
 * @property {string} tipoMime
 */
class Almacenamiento {
    /**
     * Guarda un archivo y devuelve su referencia.
     *
     * @param {object} archivo
     * @param {Buffer} archivo.contenido
     * @param {string} archivo.tipoMime
     * @param {string} [archivo.carpeta] agrupación lógica, p. ej. `contratos/<id>`
     * @param {string} [archivo.extension]
     * @returns {Promise<ArchivoGuardado>}
     */
    async guardar() {
        throw new Error('guardar() sin implementar');
    }

    /** @returns {Promise<ArchivoLeido|null>} `null` si la referencia no existe. */
    async leer() {
        throw new Error('leer() sin implementar');
    }

    /** Borra el archivo. No falla si ya no estaba. */
    async eliminar() {
        throw new Error('eliminar() sin implementar');
    }

    /** Nombre corto para el log de arranque. */
    describir() {
        return this.constructor.name;
    }
}

/**
 * Genera el nombre del archivo dentro del almacenamiento.
 *
 * UUID y no el nombre original a propósito. El nombre que trae un archivo
 * subido lo controla quien lo sube: puede traer `../../etc/passwd`, caracteres
 * que el sistema de archivos no acepta, o el nombre de otro archivo ya guardado.
 * Se descarta entero y se genera uno nuevo; el nombre original no hace falta
 * para nada, porque lo que el usuario ve al descargar lo decide el controlador.
 */
const nombreNuevo = (extension = '.pdf') => `${crypto.randomUUID()}${extension}`;

/**
 * Almacenamiento en el disco del propio proceso.
 *
 * Para desarrollo y para las pruebas. En un despliegue real NO sirve: el disco
 * de un contenedor de Container Apps se borra cuando la réplica se apaga, y con
 * scale-to-zero eso pasa todos los días.
 *
 * La raíz NO es `uploads/`. Ese directorio se servía con `express.static` y
 * cualquiera con la URL se bajaba un contrato; reutilizar el nombre invitaría a
 * volver a exponerlo. Aquí se llama `almacenamiento/` y nada lo publica.
 */
class AlmacenamientoDisco extends Almacenamiento {
    /** @param {string} [raiz] directorio base. Se crea si no existe. */
    constructor(raiz = process.env.ALMACENAMIENTO_RUTA || 'almacenamiento') {
        super();
        this.raiz = path.resolve(raiz);
    }

    /**
     * Resuelve una referencia a una ruta absoluta, sin salirse de la raíz.
     *
     * La comprobación no es paranoia: la referencia viaja en la fila de la base
     * y llega a `leer()` desde un `id_anexo` de la URL. Un `..` en medio
     * convertiría la descarga de anexos en un lector de archivos arbitrarios del
     * contenedor.
     */
    rutaDe(referencia) {
        const absoluta = path.resolve(this.raiz, referencia);

        if (absoluta !== this.raiz && !absoluta.startsWith(this.raiz + path.sep)) {
            throw new Error(`Referencia fuera del almacenamiento: ${referencia}`);
        }

        return absoluta;
    }

    async guardar({ contenido, carpeta = '', extension = '.pdf' }) {
        const referencia = path.posix.join(carpeta, nombreNuevo(extension));
        const destino = this.rutaDe(referencia);

        await fsp.mkdir(path.dirname(destino), { recursive: true });
        await fsp.writeFile(destino, contenido);

        return { referencia, tamano: contenido.length };
    }

    async leer(referencia) {
        const origen = this.rutaDe(referencia);

        let datos;
        try {
            datos = await fsp.stat(origen);
        } catch (error) {
            // Que el archivo no esté es un caso normal —una fila que quedó
            // apuntando a un disco que ya no existe— y lo resuelve el llamante
            // con un 404, no con un 500.
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }

        return {
            flujo: fs.createReadStream(origen),
            tamano: datos.size,
            tipoMime: 'application/pdf'
        };
    }

    async eliminar(referencia) {
        try {
            await fsp.unlink(this.rutaDe(referencia));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    describir() {
        return `disco (${this.raiz})`;
    }
}

/**
 * Almacenamiento en Azure Blob Storage.
 *
 * La de despliegue. Se configura con `AZURE_STORAGE_CONNECTION_STRING` y
 * `AZURE_STORAGE_CONTENEDOR`; sin la primera, `crearAlmacenamiento()` ni
 * siquiera la construye.
 *
 * EL SDK SE CARGA AQUÍ DENTRO, no arriba con los demás `require`. Así el
 * paquete no se toca en desarrollo ni en las pruebas —que usan disco— y el coste
 * de arranque sólo lo paga quien de verdad va a hablar con Azure. Es también lo
 * que hace que las suites no necesiten credenciales: nunca llegan a esta línea.
 *
 * NO GENERA URL FIRMADAS. El archivo sale por `GET /api/contratos/:id/anexos/:id`
 * y pasa por la matriz RBAC y por el ABAC del controlador. Una URL firmada es un
 * permiso que viaja solo: quien la tenga entra, aunque haya dejado de ser
 * inquilino de ese contrato, y no hay forma de revocarla antes de que caduque.
 * Es exactamente el agujero de `/uploads` con mejor presentación.
 */
class AlmacenamientoAzureBlob extends Almacenamiento {
    constructor(opciones = {}) {
        super();
        this.cadenaConexion =
            opciones.cadenaConexion || process.env.AZURE_STORAGE_CONNECTION_STRING;
        this.contenedor =
            opciones.contenedor || process.env.AZURE_STORAGE_CONTENEDOR || 'anexos';
        this.cliente = null;
    }

    /** Cliente del contenedor, creado la primera vez que hace falta. */
    async contenedorCliente() {
        if (this.cliente) {
            return this.cliente;
        }

        const { BlobServiceClient } = require('@azure/storage-blob');
        const servicio = BlobServiceClient.fromConnectionString(this.cadenaConexion);
        const contenedor = servicio.getContainerClient(this.contenedor);

        // Sin acceso anónimo: el contenedor es privado y sólo se lee a través de
        // la API. Es la mitad de la decisión de no usar URL firmadas.
        await contenedor.createIfNotExists();

        this.cliente = contenedor;
        return contenedor;
    }

    async guardar({ contenido, tipoMime = 'application/pdf', carpeta = '', extension = '.pdf' }) {
        const referencia = path.posix.join(carpeta, nombreNuevo(extension));
        const contenedor = await this.contenedorCliente();

        await contenedor.getBlockBlobClient(referencia).uploadData(contenido, {
            blobHTTPHeaders: { blobContentType: tipoMime }
        });

        return { referencia, tamano: contenido.length };
    }

    async leer(referencia) {
        const contenedor = await this.contenedorCliente();
        const blob = contenedor.getBlobClient(referencia);

        if (!(await blob.exists())) {
            return null;
        }

        // `download()` devuelve el cuerpo como flujo legible: el archivo no pasa
        // entero por la memoria del gateway.
        const descarga = await blob.download();

        return {
            flujo: descarga.readableStreamBody,
            tamano: descarga.contentLength ?? 0,
            tipoMime: descarga.contentType || 'application/pdf'
        };
    }

    async eliminar(referencia) {
        const contenedor = await this.contenedorCliente();
        await contenedor.getBlobClient(referencia).deleteIfExists();
    }

    describir() {
        return `Azure Blob (contenedor ${this.contenedor})`;
    }
}

/**
 * Elige implementación según el entorno.
 *
 * La regla es una sola línea y conviene que se lea así: **hay cadena de conexión
 * de Azure, se usa Azure; si no, disco.** Sin banderas que activar y sin un
 * `NODE_ENV` que interpretar, para que no haya forma de desplegar en Azure
 * creyendo que se está guardando en Blob mientras los archivos van a un disco
 * que se borra esa misma noche.
 */
const crearAlmacenamiento = () =>
    process.env.AZURE_STORAGE_CONNECTION_STRING
        ? new AlmacenamientoAzureBlob()
        : new AlmacenamientoDisco();

let activo = crearAlmacenamiento();

/** El almacenamiento en uso. */
const almacenamiento = () => activo;

/** Sustituye el almacenamiento. Lo usan las pruebas. */
const usarAlmacenamiento = (nuevo) => {
    activo = nuevo;
};

module.exports = {
    Almacenamiento,
    AlmacenamientoAzureBlob,
    AlmacenamientoDisco,
    CARPETA_ANEXOS,
    almacenamiento,
    crearAlmacenamiento,
    usarAlmacenamiento
};
