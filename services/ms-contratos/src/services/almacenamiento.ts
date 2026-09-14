/**
 * Almacenamiento de archivos.
 *
 * Viene del gateway sin cambios de diseño: el paso 6d solo lo muda, porque los
 * anexos son de este servicio y su almacenamiento tambien. Lo unico nuevo es que
 * ahora es TypeScript, asi que la interfaz que antes era una clase con metodos
 * que lanzaban es un `interface` de verdad y una implementacion incompleta ya no
 * compila.
 *
 * MISMA JUGADA QUE `Notificador` en ms-identidad, y por la misma razon: hay una
 * cosa que el codigo necesita hacer hoy, un sitio distinto donde tendra que
 * hacerla mañana, y ninguna de las dos debe filtrarse a la logica de negocio. El
 * controlador de anexos no sabe si el archivo acaba en un disco o en un
 * contenedor de Azure; le pide al almacenamiento que lo guarde y se queda con la
 * referencia que le devuelvan.
 *
 * DOS IMPLEMENTACIONES, Y LAS DOS HACEN FALTA.
 *
 * - `AlmacenamientoDisco` es la de desarrollo y la de las pruebas. Que exista es
 *   lo que permite que las suites sigan corriendo en un portatil sin Docker y
 *   sin credenciales de Azure, que es la regla que CLAUDE.md fija para todo el
 *   proyecto. No es un doble: es una implementacion de verdad, con sus pruebas.
 * - `AlmacenamientoAzureBlob` es la de despliegue: en Container Apps el disco del
 *   contenedor se borra cada vez que la replica se apaga. Ver `docs/adr/0014`.
 *
 * LA REFERENCIA ES OPACA. `archivo_anexo` guarda lo que devuelve `guardar()`, y
 * lo unico que se promete de ese valor es que `leer()` y `eliminar()` lo
 * entienden. Con disco es una ruta relativa a la raiz configurada; con Azure, el
 * nombre del blob. Guardar una ruta absoluta de disco —lo que hacia `url_pdf`—
 * ata la fila a la maquina que la escribio.
 *
 * LEER DEVUELVE UN FLUJO, no un Buffer. Un contrato escaneado de 10 MB por diez
 * descargas simultaneas son 100 MB de memoria en un contenedor que tiene poco
 * mas; en streaming son unos pocos kilobytes de bufer.
 */

import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { textoDeEntorno } from 'arriendos360-shared';

/** Carpeta logica donde viven los anexos dentro del almacenamiento. */
export const CARPETA_ANEXOS = 'contratos';

export interface ArchivoGuardado {
  /** Lo que se guarda en `archivo_anexo`. */
  referencia: string;
  tamano: number;
}

export interface ArchivoLeido {
  flujo: NodeJS.ReadableStream;
  tamano: number;
  tipoMime: string;
}

export interface PeticionGuardar {
  contenido: Buffer;
  tipoMime?: string;
  /** Agrupacion logica, p. ej. `contratos/<id>`. */
  carpeta?: string;
  extension?: string;
}

/**
 * Lo que cumplen las dos implementaciones.
 *
 * En TypeScript no hace falta la clase base con metodos que lanzan: una
 * implementacion a la que le falte un metodo no compila, que es mejor que
 * fallar al usarla.
 */
export interface Almacenamiento {
  guardar(archivo: PeticionGuardar): Promise<ArchivoGuardado>;
  /** `null` si la referencia no existe. */
  leer(referencia: string): Promise<ArchivoLeido | null>;
  /** Borra el archivo. No falla si ya no estaba. */
  eliminar(referencia: string): Promise<void>;
  /** Nombre corto para el log de arranque. */
  describir(): string;
}

/**
 * Genera el nombre del archivo dentro del almacenamiento.
 *
 * UUID y no el nombre original a proposito. El nombre que trae un archivo subido
 * lo controla quien lo sube: puede traer `../../etc/passwd`, caracteres que el
 * sistema de archivos no acepta, o el nombre de otro archivo ya guardado. Se
 * descarta entero y se genera uno nuevo; el nombre original no hace falta para
 * nada, porque lo que el usuario ve al descargar lo decide el controlador.
 */
const nombreNuevo = (extension = '.pdf'): string => `${crypto.randomUUID()}${extension}`;

/**
 * Almacenamiento en el disco del propio proceso.
 *
 * La raiz NO es `uploads/`. Ese directorio se servia con `express.static` y
 * cualquiera con la URL se bajaba un contrato; reutilizar el nombre invitaria a
 * volver a exponerlo. Aqui se llama `almacenamiento/` y nada lo publica.
 */
export class AlmacenamientoDisco implements Almacenamiento {
  private readonly raiz: string;

  constructor(raiz: string = textoDeEntorno('ALMACENAMIENTO_RUTA', 'almacenamiento')) {
    this.raiz = path.resolve(raiz);
  }

  /**
   * Resuelve una referencia a una ruta absoluta, sin salirse de la raiz.
   *
   * La comprobacion no es paranoia: la referencia viaja en la fila de la base y
   * llega a `leer()` desde un `id_anexo` de la URL. Un `..` en medio convertiria
   * la descarga de anexos en un lector de archivos arbitrarios del contenedor.
   */
  private rutaDe(referencia: string): string {
    const absoluta = path.resolve(this.raiz, referencia);

    if (absoluta !== this.raiz && !absoluta.startsWith(this.raiz + path.sep)) {
      throw new Error(`Referencia fuera del almacenamiento: ${referencia}`);
    }

    return absoluta;
  }

  async guardar({ contenido, carpeta = '', extension = '.pdf' }: PeticionGuardar): Promise<ArchivoGuardado> {
    const referencia = path.posix.join(carpeta, nombreNuevo(extension));
    const destino = this.rutaDe(referencia);

    await fsp.mkdir(path.dirname(destino), { recursive: true });
    await fsp.writeFile(destino, contenido);

    return { referencia, tamano: contenido.length };
  }

  async leer(referencia: string): Promise<ArchivoLeido | null> {
    const origen = this.rutaDe(referencia);

    let datos;
    try {
      datos = await fsp.stat(origen);
    } catch (error) {
      // Que el archivo no este es un caso normal —una fila que quedo apuntando a
      // un disco que ya no existe— y lo resuelve el llamante con un 404.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    return {
      flujo: fs.createReadStream(origen),
      tamano: datos.size,
      tipoMime: 'application/pdf',
    };
  }

  async eliminar(referencia: string): Promise<void> {
    try {
      await fsp.unlink(this.rutaDe(referencia));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  describir(): string {
    return `disco (${this.raiz})`;
  }
}

/**
 * Almacenamiento en Azure Blob Storage.
 *
 * EL SDK SE CARGA AQUI DENTRO, no arriba con los demas `import`. Asi el paquete
 * no se toca en desarrollo ni en las pruebas —que usan disco— y el coste de
 * arranque solo lo paga quien de verdad va a hablar con Azure. Es tambien lo que
 * hace que las suites no necesiten credenciales: nunca llegan a esta linea.
 *
 * NO GENERA URL FIRMADAS. El archivo sale por
 * `GET /api/contratos/:id/anexos/:idAnexo` y pasa por la matriz RBAC del gateway
 * y por el ABAC de este servicio. Una URL firmada es un permiso que viaja solo:
 * quien la tenga entra, aunque haya dejado de ser inquilino de ese contrato, y
 * no hay forma de revocarla antes de que caduque.
 */
export class AlmacenamientoAzureBlob implements Almacenamiento {
  private readonly cadenaConexion: string | undefined;
  private readonly contenedor: string;
  private cliente: unknown = null;

  constructor(opciones: { cadenaConexion?: string; contenedor?: string } = {}) {
    this.cadenaConexion =
      opciones.cadenaConexion ?? process.env['AZURE_STORAGE_CONNECTION_STRING'];
    this.contenedor =
      opciones.contenedor ?? textoDeEntorno('AZURE_STORAGE_CONTENEDOR', 'anexos');
  }

  /** Cliente del contenedor, creado la primera vez que hace falta. */
  private async contenedorCliente(): Promise<never> {
    if (this.cliente) {
      return this.cliente as never;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BlobServiceClient } = require('@azure/storage-blob');
    const servicio = BlobServiceClient.fromConnectionString(this.cadenaConexion);
    const contenedor = servicio.getContainerClient(this.contenedor);

    // Sin acceso anonimo: el contenedor es privado y solo se lee a traves de la
    // API. Es la mitad de la decision de no usar URL firmadas.
    await contenedor.createIfNotExists();

    this.cliente = contenedor;
    return contenedor as never;
  }

  async guardar({
    contenido,
    tipoMime = 'application/pdf',
    carpeta = '',
    extension = '.pdf',
  }: PeticionGuardar): Promise<ArchivoGuardado> {
    const referencia = path.posix.join(carpeta, nombreNuevo(extension));
    const contenedor = (await this.contenedorCliente()) as {
      getBlockBlobClient(nombre: string): {
        uploadData(datos: Buffer, opciones: unknown): Promise<unknown>;
      };
    };

    await contenedor.getBlockBlobClient(referencia).uploadData(contenido, {
      blobHTTPHeaders: { blobContentType: tipoMime },
    });

    return { referencia, tamano: contenido.length };
  }

  async leer(referencia: string): Promise<ArchivoLeido | null> {
    const contenedor = (await this.contenedorCliente()) as {
      getBlobClient(nombre: string): {
        exists(): Promise<boolean>;
        download(): Promise<{
          readableStreamBody?: NodeJS.ReadableStream;
          contentLength?: number;
          contentType?: string;
        }>;
      };
    };
    const blob = contenedor.getBlobClient(referencia);

    if (!(await blob.exists())) {
      return null;
    }

    // `download()` devuelve el cuerpo como flujo legible: el archivo no pasa
    // entero por la memoria del servicio.
    const descarga = await blob.download();

    return {
      flujo: descarga.readableStreamBody as NodeJS.ReadableStream,
      tamano: descarga.contentLength ?? 0,
      tipoMime: descarga.contentType ?? 'application/pdf',
    };
  }

  async eliminar(referencia: string): Promise<void> {
    const contenedor = (await this.contenedorCliente()) as {
      getBlobClient(nombre: string): { deleteIfExists(): Promise<unknown> };
    };
    await contenedor.getBlobClient(referencia).deleteIfExists();
  }

  describir(): string {
    return `Azure Blob (contenedor ${this.contenedor})`;
  }
}

/**
 * Elige implementacion segun el entorno.
 *
 * La regla es una sola linea y conviene que se lea asi: **hay cadena de conexion
 * de Azure, se usa Azure; si no, disco.** Sin banderas que activar y sin un
 * `NODE_ENV` que interpretar, para que no haya forma de desplegar en Azure
 * creyendo que se esta guardando en Blob mientras los archivos van a un disco
 * que se borra esa misma noche.
 */
export const crearAlmacenamiento = (): Almacenamiento =>
  process.env['AZURE_STORAGE_CONNECTION_STRING']
    ? new AlmacenamientoAzureBlob()
    : new AlmacenamientoDisco();

let activo: Almacenamiento = crearAlmacenamiento();

/** El almacenamiento en uso. */
export const almacenamiento = (): Almacenamiento => activo;

/** Sustituye el almacenamiento. Lo usan las pruebas. */
export const usarAlmacenamiento = (nuevo: Almacenamiento): void => {
  activo = nuevo;
};
