/**
 * Composición de datos de usuario.
 *
 * Sustituye a los `include` que cruzaban la frontera de ms-identidad. Se prueba
 * contra un doble HTTP, no contra un mock de función, porque lo que interesa es
 * que el cliente hable bien por red y que degrade cuando el otro extremo no está.
 */

// Esta suite no carga `src/app.js`, que es quien normalmente llama a dotenv, así
// que el .env se carga aquí: el cliente necesita SERVICIO_JWT_SECRET para firmar
// las llamadas a /interno, y el doble la misma clave para verificarlas.
require('dotenv').config();

const {
    adjuntarInquilino,
    adjuntarInquilinos,
    adjuntarPartes
} = require('../src/clientes/composicion');
const { crearIdentidadFalsa } = require('./dobles/identidad');

const ID_ANA = '11111111-1111-4111-8111-111111111111';
const ID_BRUNO = '22222222-2222-4222-8222-222222222222';

let identidad;

beforeAll(async () => {
    identidad = await crearIdentidadFalsa();
    process.env.MS_IDENTIDAD_URL = identidad.url;

    identidad.usuarios.set(ID_ANA, {
        id: ID_ANA,
        nombres: 'Ana',
        apellidos: 'Propietaria',
        documento: '1',
        telefono: '3001',
        email: 'ana@test.com',
        roles: ['PROPIETARIO']
    });
    identidad.usuarios.set(ID_BRUNO, {
        id: ID_BRUNO,
        nombres: 'Bruno',
        apellidos: 'Inquilino',
        documento: '2',
        telefono: '3002',
        email: 'bruno@test.com',
        roles: ['INQUILINO']
    });
});

afterAll(async () => {
    await identidad.cerrar();
    delete process.env.MS_IDENTIDAD_URL;
});

describe('adjuntarInquilinos', () => {
    test('da al inquilino la misma forma que producía el include', async () => {
        const [contrato] = await adjuntarInquilinos([{ id_contrato: 'c1', id_inquilino: ID_BRUNO }]);

        expect(contrato.Inquilino).toEqual({
            id_usuario: ID_BRUNO,
            nombres: 'Bruno',
            apellidos: 'Inquilino',
            documento: '2',
            telefono: '3002',
            email: 'bruno@test.com'
        });
    });

    test('resuelve la lista entera con UNA sola petición', async () => {
        // Es el punto de todo el diseño: componer dentro de un bucle sería
        // cambiar un JOIN por N llamadas de red.
        identidad.limpiarLlamadas();

        await adjuntarInquilinos([
            { id_contrato: 'c1', id_inquilino: ID_BRUNO },
            { id_contrato: 'c2', id_inquilino: ID_ANA },
            { id_contrato: 'c3', id_inquilino: ID_BRUNO }
        ]);

        const consultas = identidad.llamadas.filter((l) => l.ruta.startsWith('/interno/usuarios'));
        expect(consultas).toHaveLength(1);
    });

    test('no repite un id que aparece en varios contratos', async () => {
        identidad.limpiarLlamadas();

        await adjuntarInquilinos([
            { id_contrato: 'c1', id_inquilino: ID_BRUNO },
            { id_contrato: 'c2', id_inquilino: ID_BRUNO }
        ]);

        const consulta = identidad.llamadas.find((l) => l.ruta.startsWith('/interno/usuarios'));
        // Si el id apareciera dos veces, al partir por él saldrían tres trozos.
        expect(consulta.ruta.split(ID_BRUNO)).toHaveLength(2);
    });

    test('una lista vacía no llama a nadie', async () => {
        identidad.limpiarLlamadas();
        const resultado = await adjuntarInquilinos([]);

        expect(resultado).toEqual([]);
        expect(identidad.llamadas.filter((l) => l.ruta.startsWith('/interno'))).toHaveLength(0);
    });

    test('un inquilino inexistente queda en null, no rompe la lista', async () => {
        const [contrato] = await adjuntarInquilinos([
            { id_contrato: 'c1', id_inquilino: '99999999-9999-4999-8999-999999999999' }
        ]);

        expect(contrato.Inquilino).toBeNull();
        expect(contrato.id_contrato).toBe('c1');
    });
});

describe('adjuntarInquilino', () => {
    test('funciona sobre un contrato suelto', async () => {
        const contrato = await adjuntarInquilino({ id_contrato: 'c1', id_inquilino: ID_BRUNO });
        expect(contrato.Inquilino.nombres).toBe('Bruno');
    });

    test('tolera null', async () => {
        expect(await adjuntarInquilino(null)).toBeNull();
    });
});

describe('adjuntarPartes', () => {
    test('resuelve inquilino y propietario en un solo viaje', async () => {
        identidad.limpiarLlamadas();

        const [contrato] = await adjuntarPartes([
            {
                id_contrato: 'c1',
                id_inquilino: ID_BRUNO,
                Inmueble: { id_propietario: ID_ANA, direccion: 'Calle 1' }
            }
        ]);

        expect(contrato.Inquilino.nombres).toBe('Bruno');
        expect(contrato.Inmueble.Propietario.email).toBe('ana@test.com');
        expect(contrato.Inmueble.direccion).toBe('Calle 1');

        const consultas = identidad.llamadas.filter((l) => l.ruta.startsWith('/interno/usuarios'));
        expect(consultas).toHaveLength(1);
    });

    test('un contrato sin inmueble no revienta', async () => {
        const [contrato] = await adjuntarPartes([{ id_contrato: 'c1', id_inquilino: ID_BRUNO }]);

        expect(contrato.Inquilino.nombres).toBe('Bruno');
        expect(contrato.Inmueble).toBeUndefined();
    });
});

describe('Cuando ms-identidad no responde', () => {
    test('devuelve los contratos con el usuario en null, no un error', async () => {
        // Un contrato sin el nombre del inquilino sigue siendo útil; un 502 en
        // el listado entero porque identidad tosió, no.
        const url = process.env.MS_IDENTIDAD_URL;
        process.env.MS_IDENTIDAD_URL = 'http://127.0.0.1:1';

        const [contrato] = await adjuntarInquilinos([{ id_contrato: 'c1', id_inquilino: ID_BRUNO }]);

        expect(contrato.id_contrato).toBe('c1');
        expect(contrato.Inquilino).toBeNull();

        process.env.MS_IDENTIDAD_URL = url;
    });

    test('sin MS_IDENTIDAD_URL tampoco falla', async () => {
        const url = process.env.MS_IDENTIDAD_URL;
        delete process.env.MS_IDENTIDAD_URL;

        const [contrato] = await adjuntarInquilinos([{ id_contrato: 'c1', id_inquilino: ID_BRUNO }]);
        expect(contrato.Inquilino).toBeNull();

        process.env.MS_IDENTIDAD_URL = url;
    });
});
