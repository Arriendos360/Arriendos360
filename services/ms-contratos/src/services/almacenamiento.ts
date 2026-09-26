/**
 * Almacenamiento de los archivos de anexos: en disco (desarrollo y pruebas) o en
 * Azure Blob Storage (despliegue). `archivo_anexo` guarda una referencia opaca
 * que sólo entienden `leer()` y `eliminar()`. Leer devuelve un flujo.
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

/** Lo que cumplen las dos implementaciones. */
export interface Almacenamiento {
  guardar(archivo: PeticionGuardar): Promise<ArchivoGuardado>;
  /** `null` si la referencia no existe. */
  leer(referencia: string): Promise<ArchivoLeido | null>;
  /** Borra el archivo. No falla si ya no estaba. */
  eliminar(referencia: string): Promise<void>;
  /** Nombre corto para el log de arranque. */
  describir(): string;
}

/** Nombre del archivo en el almacenamiento: un UUID, nunca el nombre original. */
const nombreNuevo = (extension = '.pdf'): string => `${crypto.randomUUID()}${extension}`;

/** Almacenamiento en disco, bajo `ALMACENAMIENTO_RUTA`. Nada lo publica. */
export class AlmacenamientoDisco implements Almacenamiento {
  private readonly raiz: string;

  constructor(raiz: string = textoDeEntorno('ALMACENAMIENTO_RUTA', 'almacenamiento')) {
    this.raiz = path.resolve(raiz);
  }

  /** Resuelve una referencia a una ruta absoluta; lanza si se sale de la raíz. */
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
      // Archivo ausente: `null`, y el llamante responde 404.
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
 * Almacenamiento en Azure Blob Storage, en un contenedor privado. El SDK se carga
 * al primer uso. No genera URL firmadas: los archivos sólo salen por la API.
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

    // Contenedor privado, sin acceso anónimo.
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

/** Con `AZURE_STORAGE_CONNECTION_STRING`, Azure Blob; sin ella, disco. */
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
