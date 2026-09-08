import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  AlmacenamientoAzureBlob,
  AlmacenamientoDisco,
  crearAlmacenamiento,
} from '../src/services/almacenamiento';

/**
 * El almacenamiento de anexos, sus dos implementaciones y la eleccion entre ellas.
 *
 * Se muda desde `apps/gateway/tests/almacenamiento.test.js` con el codigo. En
 * TypeScript sobra una de las pruebas que habia —«los metodos sin implementar
 * lanzan»— porque el compilador ya no deja escribir una implementacion
 * incompleta: la clase base con metodos que lanzaban se convirtio en un
 * `interface`, y eso es una comprobacion mas fuerte que la que hacia el test.
 *
 * `AlmacenamientoDisco` NO es un doble: es la implementacion de desarrollo y de
 * las pruebas, con archivos de verdad en un directorio temporal. Que exista es
 * lo que permite que las suites corran en un portatil sin Docker y sin
 * credenciales de Azure.
 */

/** Lee un flujo entero. Solo para comprobar en las pruebas lo que se escribio. */
const leerFlujo = async (flujo: NodeJS.ReadableStream): Promise<Buffer> => {
  const trozos: Buffer[] = [];
  for await (const trozo of flujo) {
    trozos.push(trozo as Buffer);
  }
  return Buffer.concat(trozos);
};

describe('Almacenamiento en disco', () => {
  let raiz: string;
  let almacen: AlmacenamientoDisco;

  beforeEach(async () => {
    raiz = await fsp.mkdtemp(path.join(os.tmpdir(), 'anexos-'));
    almacen = new AlmacenamientoDisco(raiz);
  });

  afterEach(async () => {
    await fsp.rm(raiz, { recursive: true, force: true });
  });

  test('guardar devuelve una referencia y escribe el archivo', async () => {
    const contenido = Buffer.from('%PDF-1.4 contenido');

    const { referencia, tamano } = await almacen.guardar({
      contenido,
      carpeta: 'contratos/abc',
    });

    expect(tamano).toBe(contenido.length);
    expect(referencia).toContain('contratos/abc/');
    expect(fs.existsSync(path.join(raiz, referencia))).toBe(true);
  });

  test('el nombre lo genera el almacenamiento, no quien sube', async () => {
    // El nombre de un archivo subido lo controla quien lo sube: puede traer
    // `../../etc/passwd`, caracteres que el sistema no acepta, o el nombre de
    // otro archivo ya guardado. Se descarta entero y se genera uno nuevo.
    const primero = await almacen.guardar({ contenido: Buffer.from('a'), carpeta: 'x' });
    const segundo = await almacen.guardar({ contenido: Buffer.from('b'), carpeta: 'x' });

    expect(primero.referencia).not.toBe(segundo.referencia);
    expect(primero.referencia).toMatch(/x\/[0-9a-f-]{36}\.pdf$/);
  });

  test('leer devuelve un FLUJO, no el archivo entero en memoria', async () => {
    // Diez descargas simultaneas de un contrato de 10 MB serian 100 MB de
    // memoria si se cargaran enteros, en un contenedor que no los tiene.
    const contenido = Buffer.from('%PDF-1.4 en streaming');
    const { referencia } = await almacen.guardar({ contenido, carpeta: 'c' });

    const archivo = await almacen.leer(referencia);

    expect(archivo).not.toBeNull();
    expect(typeof archivo?.flujo.pipe).toBe('function');
    expect(archivo?.tamano).toBe(contenido.length);
    expect(archivo?.tipoMime).toBe('application/pdf');
    expect((await leerFlujo(archivo!.flujo)).equals(contenido)).toBe(true);
  });

  test('leer algo que no existe devuelve null, no lanza', async () => {
    // Es un caso normal —una fila que quedo apuntando a un disco que ya no
    // existe— y lo resuelve el llamante con un 404, no con un 500.
    expect(await almacen.leer('c/no-existe.pdf')).toBeNull();
  });

  test('eliminar borra, y borrar dos veces no falla', async () => {
    const { referencia } = await almacen.guardar({ contenido: Buffer.from('x'), carpeta: 'c' });

    await almacen.eliminar(referencia);
    expect(fs.existsSync(path.join(raiz, referencia))).toBe(false);

    await expect(almacen.eliminar(referencia)).resolves.toBeUndefined();
  });

  test('una referencia con `..` no se sale de la raiz', async () => {
    // No es paranoia: la referencia viaja en la fila de la base y llega a
    // `leer()` desde un `id_anexo` de la URL. Un `..` en medio convertiria la
    // descarga de anexos en un lector de archivos arbitrarios del contenedor.
    await expect(almacen.leer('../../etc/passwd')).rejects.toThrow(
      /fuera del almacenamiento/,
    );
  });

  test('una carpeta que no existe se crea sola', async () => {
    const { referencia } = await almacen.guardar({
      contenido: Buffer.from('x'),
      carpeta: 'contratos/nueva/mas-honda',
    });

    expect(fs.existsSync(path.join(raiz, referencia))).toBe(true);
  });
});

describe('Que implementacion se elige', () => {
  const original = process.env['AZURE_STORAGE_CONNECTION_STRING'];

  afterEach(() => {
    if (original === undefined) {
      delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
    } else {
      process.env['AZURE_STORAGE_CONNECTION_STRING'] = original;
    }
  });

  test('sin cadena de conexion, disco', () => {
    delete process.env['AZURE_STORAGE_CONNECTION_STRING'];
    expect(crearAlmacenamiento()).toBeInstanceOf(AlmacenamientoDisco);
  });

  test('con cadena de conexion, Azure', () => {
    // La regla es una sola linea y conviene que se lea asi. Sin banderas que
    // activar y sin un `NODE_ENV` que interpretar, para que no haya forma de
    // desplegar creyendo que se guarda en Blob mientras los archivos van a un
    // disco que se borra esa misma noche.
    process.env['AZURE_STORAGE_CONNECTION_STRING'] = 'UseDevelopmentStorage=true';
    expect(crearAlmacenamiento()).toBeInstanceOf(AlmacenamientoAzureBlob);
  });

  test('construir el de Azure no toca el SDK ni la red', () => {
    // El SDK se carga dentro del metodo, no arriba con los demas `import`. Es lo
    // que hace que estas suites no necesiten credenciales: nunca llegan a esa
    // linea.
    expect(
      () => new AlmacenamientoAzureBlob({ cadenaConexion: 'no-vale', contenedor: 'x' }),
    ).not.toThrow();
  });

  test('las dos implementaciones cumplen la interfaz', () => {
    // En TypeScript esto lo garantiza el compilador —una implementacion
    // incompleta no compila— pero se comprueba igual porque el `describir()` de
    // cada una sale en el log de arranque y conviene que diga algo util.
    expect(new AlmacenamientoDisco('/tmp/x').describir()).toContain('disco');
    expect(new AlmacenamientoAzureBlob({ contenedor: 'anexos' }).describir()).toContain(
      'Azure Blob',
    );
  });
});
