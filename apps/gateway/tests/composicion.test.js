/**
 * Composición de datos de otros servicios.
 *
 * Se prueba contra dobles HTTP, no contra mocks de función, porque lo que
 * interesa es que los clientes hablen bien por red y que degraden cuando el otro
 * extremo no está.
 */

// Esta suite no carga `src/app.js`, que es quien normalmente llama a dotenv, así
// que el .env se carga aquí: los clientes necesitan SERVICIO_JWT_SECRET para
// firmar las llamadas a /interno, y los dobles la misma clave para verificarlas.
require('dotenv').config();

const { adjuntarInmuebles } = require('../src/clientes/composicion');
const { dePropietario } = require('../src/clientes/inmuebles');
const { crearInmueblesFalso } = require('./dobles/inmuebles');

const ID_ANA = '11111111-1111-4111-8111-111111111111';
const ID_CASA = '33333333-3333-4333-8333-333333333333';
const ID_FANTASMA = '99999999-9999-4999-8999-999999999999';

let inmuebles;

beforeAll(async () => {
    inmuebles = await crearInmueblesFalso();
    process.env.MS_INMUEBLES_URL = inmuebles.url;

    inmuebles.inmuebles.set(ID_CASA, {
        id_inmueble: ID_CASA,
        direccion: 'Calle 1',
        tipo: 'casa',
        estado: 'arrendado',
        id_propietario: ID_ANA
    });
});

afterAll(async () => {
    await inmuebles.cerrar();
    delete process.env.MS_INMUEBLES_URL;
});

describe('adjuntarInmuebles', () => {
    test('ocupa el lugar del include: el inmueble queda anidado en el contrato', async () => {
        const [contrato] = await adjuntarInmuebles([{ id_contrato: 'c1', id_inmueble: ID_CASA }]);

        expect(contrato.Inmueble.direccion).toBe('Calle 1');
        expect(contrato.Inmueble.id_propietario).toBe(ID_ANA);
    });

    test('un inmueble que no existe deja la propiedad en null, no revienta', async () => {
        const [contrato] = await adjuntarInmuebles([
            { id_contrato: 'c1', id_inmueble: ID_FANTASMA }
        ]);

        expect(contrato.Inmueble).toBeNull();
    });

    test('una lista entera se resuelve en UNA sola petición', async () => {
        // El N+1, pero con latencia de red, es el error que esta función existe
        // para evitar.
        inmuebles.llamadas.length = 0;

        await adjuntarInmuebles([
            { id_contrato: 'c1', id_inmueble: ID_CASA },
            { id_contrato: 'c2', id_inmueble: ID_CASA },
            { id_contrato: 'c3', id_inmueble: ID_CASA }
        ]);

        const consultas = inmuebles.llamadas.filter((l) => l.ruta.startsWith('/interno/inmuebles'));
        expect(consultas).toHaveLength(1);
    });
});

describe('Cuando ms-inmuebles no responde', () => {
    test('componer degrada a null, porque decorar no es autorizar', async () => {
        const url = process.env.MS_INMUEBLES_URL;
        process.env.MS_INMUEBLES_URL = 'http://127.0.0.1:1';

        const [contrato] = await adjuntarInmuebles([{ id_contrato: 'c1', id_inmueble: ID_CASA }]);
        expect(contrato.Inmueble).toBeNull();

        process.env.MS_INMUEBLES_URL = url;
    });

    test('pero la consulta que alimenta el dashboard propaga el fallo en vez de devolver lista vacía', async () => {
        // Una lista vacía haría que un propietario viera «0 inmuebles»: una
        // respuesta creíble y falsa.
        const url = process.env.MS_INMUEBLES_URL;
        process.env.MS_INMUEBLES_URL = 'http://127.0.0.1:1';

        await expect(dePropietario(ID_ANA)).rejects.toThrow();

        process.env.MS_INMUEBLES_URL = url;
    });
});
