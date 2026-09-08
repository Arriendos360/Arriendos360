/**
 * El almacenamiento de archivos, sin base y sin credenciales.
 *
 * Es lo que hace que la regla de CLAUDE.md siga en pie —las suites corren en un
 * portátil sin Docker— y la razón de que la implementación de disco NO sea un
 * doble: es la que usa el desarrollo, tiene su propia lógica (rutas, streaming,
 * archivos que faltan) y esa lógica hay que probarla.
 *
 * De `AlmacenamientoAzureBlob` se comprueba lo único comprobable sin una cuenta
 * de Azure: que se elige cuando toca y que no se toca cuando no. Su
 * comportamiento contra el servicio real no se puede simular aquí, y fingirlo
 * con un doble del SDK daría una confianza que no existe.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
    Almacenamiento,
    AlmacenamientoAzureBlob,
    AlmacenamientoDisco,
    crearAlmacenamiento
} = require('../src/services/almacenamiento');

/** Junta un flujo en un Buffer. Sólo para comprobar lo que salió. */
const leerFlujo = async (flujo) => {
    const trozos = [];
    for await (const trozo of flujo) {
        trozos.push(trozo);
    }
    return Buffer.concat(trozos);
};

const PDF = Buffer.from('%PDF-1.7\nun contrato escaneado\n%%EOF');

let raiz;
let disco;

beforeAll(async () => {
    // Fuera del repositorio: una prueba no debería dejar basura en el árbol de
    // trabajo, y menos archivos que se parecen a los que sirve la aplicación.
    raiz = await fsp.mkdtemp(path.join(os.tmpdir(), 'arriendos360-almacen-'));
    disco = new AlmacenamientoDisco(raiz);
});

afterAll(async () => {
    await fsp.rm(raiz, { recursive: true, force: true });
});

describe('La interfaz obliga a implementarla', () => {
    test('los métodos sin implementar lanzan, no devuelven undefined', async () => {
        // Se declara como clase con métodos que fallan, y no como un comentario,
        // para que una implementación a medias se note al usarse y no más tarde
        // con un `undefined` viajando por el controlador.
        const incompleto = new Almacenamiento();

        await expect(incompleto.guardar({})).rejects.toThrow('guardar()');
        await expect(incompleto.leer('x')).rejects.toThrow('leer()');
        await expect(incompleto.eliminar('x')).rejects.toThrow('eliminar()');
    });

    test('las dos implementaciones la cumplen', () => {
        expect(new AlmacenamientoDisco(raiz)).toBeInstanceOf(Almacenamiento);
        expect(new AlmacenamientoAzureBlob({ cadenaConexion: 'x' })).toBeInstanceOf(Almacenamiento);
    });
});

describe('Almacenamiento en disco', () => {
    test('guardar devuelve una referencia y escribe el archivo', async () => {
        const { referencia, tamano } = await disco.guardar({
            contenido: PDF,
            carpeta: 'contratos/abc'
        });

        expect(tamano).toBe(PDF.length);
        // La referencia es relativa a la raíz: no lleva la ruta de la máquina.
        expect(path.isAbsolute(referencia)).toBe(false);
        expect(referencia.startsWith('contratos/abc/')).toBe(true);
        expect(fs.existsSync(path.join(raiz, referencia))).toBe(true);
    });

    test('el nombre lo genera el almacenamiento, no quien sube', async () => {
        // El nombre original lo controla el cliente: puede traer `../`, nombres
        // que el sistema de archivos rechaza, o el de un archivo ya guardado.
        // Se descarta entero.
        const uno = await disco.guardar({ contenido: PDF, carpeta: 'c' });
        const otro = await disco.guardar({ contenido: PDF, carpeta: 'c' });

        expect(uno.referencia).not.toBe(otro.referencia);
        expect(path.basename(uno.referencia)).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    });

    test('leer devuelve un FLUJO, no el archivo entero en memoria', async () => {
        const { referencia } = await disco.guardar({ contenido: PDF, carpeta: 'c' });
        const archivo = await disco.leer(referencia);

        expect(typeof archivo.flujo.pipe).toBe('function');
        expect(archivo.tamano).toBe(PDF.length);
        expect(archivo.tipoMime).toBe('application/pdf');
        expect(await leerFlujo(archivo.flujo)).toEqual(PDF);
    });

    test('leer algo que no existe devuelve null, no lanza', async () => {
        // Es un caso normal —una fila que apunta a un disco que ya no está— y lo
        // resuelve el controlador con un 404, no con un 500.
        expect(await disco.leer('contratos/abc/no-existe.pdf')).toBeNull();
    });

    test('eliminar borra, y borrar dos veces no falla', async () => {
        const { referencia } = await disco.guardar({ contenido: PDF, carpeta: 'c' });

        await disco.eliminar(referencia);
        expect(fs.existsSync(path.join(raiz, referencia))).toBe(false);

        await expect(disco.eliminar(referencia)).resolves.toBeUndefined();
    });

    test('una referencia con `..` no se sale de la raíz', async () => {
        // La referencia viaja en la fila de la base y llega hasta aquí desde un
        // `id_anexo` de la URL. Sin esta guarda, la descarga de anexos sería un
        // lector de archivos arbitrarios del contenedor.
        await expect(disco.leer('../../etc/passwd')).rejects.toThrow('fuera del almacenamiento');
        await expect(disco.eliminar('contratos/../../fuera.pdf')).rejects.toThrow(
            'fuera del almacenamiento'
        );
    });

    test('una carpeta que no existe se crea sola', async () => {
        const { referencia } = await disco.guardar({
            contenido: PDF,
            carpeta: 'contratos/recien/anidada'
        });

        expect(fs.existsSync(path.join(raiz, referencia))).toBe(true);
    });
});

describe('Qué implementación se elige', () => {
    const original = process.env.AZURE_STORAGE_CONNECTION_STRING;

    afterEach(() => {
        if (original === undefined) {
            delete process.env.AZURE_STORAGE_CONNECTION_STRING;
        } else {
            process.env.AZURE_STORAGE_CONNECTION_STRING = original;
        }
    });

    test('sin cadena de conexión, disco', () => {
        delete process.env.AZURE_STORAGE_CONNECTION_STRING;

        expect(crearAlmacenamiento()).toBeInstanceOf(AlmacenamientoDisco);
    });

    test('con cadena de conexión, Azure', () => {
        // La regla es una sola condición a propósito: sin banderas que activar ni
        // `NODE_ENV` que interpretar, para que no haya forma de desplegar en
        // Azure creyendo que se guarda en Blob mientras los archivos van a un
        // disco que se borra esa misma noche.
        process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';

        expect(crearAlmacenamiento()).toBeInstanceOf(AlmacenamientoAzureBlob);
    });

    test('construir el de Azure no toca el SDK ni la red', () => {
        // El `require` del SDK está dentro del método, no arriba del archivo. Es
        // lo que permite que estas pruebas corran sin credenciales y sin pagar el
        // arranque del paquete: nunca se llega a esa línea.
        const azure = new AlmacenamientoAzureBlob({
            cadenaConexion: 'UseDevelopmentStorage=true',
            contenedor: 'anexos-de-prueba'
        });

        expect(azure.cliente).toBeNull();
        expect(azure.describir()).toContain('anexos-de-prueba');
    });
});
