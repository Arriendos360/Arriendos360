/**
 * Composición de datos de otros servicios.
 *
 * Sustituye a los `include` que cruzaban la frontera de ms-identidad y, desde el
 * paso 4, también los de ms-inmuebles. Se prueba contra dobles HTTP, no contra
 * mocks de función, porque lo que interesa es que los clientes hablen bien por
 * red y que degraden cuando el otro extremo no está.
 */

// Esta suite no carga `src/app.js`, que es quien normalmente llama a dotenv, así
// que el .env se carga aquí: los clientes necesitan SERVICIO_JWT_SECRET para
// firmar las llamadas a /interno, y los dobles la misma clave para verificarlas.
require('dotenv').config();

const {
    adjuntarInmueble,
    adjuntarInmuebles,
    adjuntarInquilino,
    adjuntarInquilinos,
    adjuntarInquilinosEInmuebles,
    adjuntarPartes
} = require('../src/clientes/composicion');
const { crearIdentidadFalsa } = require('./dobles/identidad');
const { crearInmueblesFalso } = require('./dobles/inmuebles');

const ID_ANA = '11111111-1111-4111-8111-111111111111';
const ID_BRUNO = '22222222-2222-4222-8222-222222222222';
const ID_CASA = '33333333-3333-4333-8333-333333333333';
const ID_FANTASMA = '99999999-9999-4999-8999-999999999999';

let identidad;
let inmuebles;

beforeAll(async () => {
    identidad = await crearIdentidadFalsa();
    inmuebles = await crearInmueblesFalso();
    process.env.MS_IDENTIDAD_URL = identidad.url;
    process.env.MS_INMUEBLES_URL = inmuebles.url;

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

    inmuebles.inmuebles.set(ID_CASA, {
        id_inmueble: ID_CASA,
        direccion: 'Calle 1',
        tipo: 'casa',
        estado: 'arrendado',
        id_propietario: ID_ANA
    });
});

afterAll(async () => {
    await identidad.cerrar();
    await inmuebles.cerrar();
    delete process.env.MS_IDENTIDAD_URL;
    delete process.env.MS_INMUEBLES_URL;
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
            { id_contrato: 'c1', id_inquilino: ID_FANTASMA }
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

    test('funciona sobre un contrato suelto y tolera null', async () => {
        const contrato = await adjuntarInmueble({ id_contrato: 'c1', id_inmueble: ID_CASA });

        expect(contrato.Inmueble.tipo).toBe('casa');
        expect(await adjuntarInmueble(null)).toBeNull();
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

describe('adjuntarInquilinosEInmuebles', () => {
    test('trae las dos cosas, con una petición a cada servicio', async () => {
        identidad.limpiarLlamadas();
        inmuebles.llamadas.length = 0;

        const [contrato] = await adjuntarInquilinosEInmuebles([
            { id_contrato: 'c1', id_inquilino: ID_BRUNO, id_inmueble: ID_CASA }
        ]);

        expect(contrato.Inquilino.nombres).toBe('Bruno');
        expect(contrato.Inmueble.direccion).toBe('Calle 1');

        expect(
            identidad.llamadas.filter((l) => l.ruta.startsWith('/interno/usuarios'))
        ).toHaveLength(1);
        expect(
            inmuebles.llamadas.filter((l) => l.ruta.startsWith('/interno/inmuebles'))
        ).toHaveLength(1);
    });
});

describe('adjuntarPartes', () => {
    test('resuelve la cadena entera: inquilino, inmueble y propietario del inmueble', async () => {
        // Era un `include` anidado de dos niveles. Ahora son dos saltos que NO se
        // pueden paralelizar: hasta que ms-inmuebles no dice de quién es el
        // inmueble, no se sabe qué propietario pedirle a ms-identidad.
        identidad.limpiarLlamadas();

        const [contrato] = await adjuntarPartes([
            { id_contrato: 'c1', id_inquilino: ID_BRUNO, id_inmueble: ID_CASA }
        ]);

        expect(contrato.Inquilino.nombres).toBe('Bruno');
        expect(contrato.Inmueble.direccion).toBe('Calle 1');
        expect(contrato.Inmueble.Propietario.email).toBe('ana@test.com');

        // Inquilinos y propietarios, juntos, en una sola consulta a identidad.
        const consultas = identidad.llamadas.filter((l) => l.ruta.startsWith('/interno/usuarios'));
        expect(consultas).toHaveLength(1);
    });

    test('un contrato sin inmueble no revienta', async () => {
        const [contrato] = await adjuntarPartes([{ id_contrato: 'c1', id_inquilino: ID_BRUNO }]);

        expect(contrato.Inquilino.nombres).toBe('Bruno');
        expect(contrato.Inmueble).toBeNull();
    });

    test('si ms-inmuebles no responde, el aviso pierde el inmueble pero no el inquilino', async () => {
        // Degradar aquí es lo correcto, al revés que en los controladores: el
        // motor financiero no autoriza a nadie, solo avisa. Un barrido que no
        // manda un correo es un incidente menor; uno que no genera las cuentas
        // de cobro del mes, no.
        inmuebles.caer();

        const [contrato] = await adjuntarPartes([
            { id_contrato: 'c1', id_inquilino: ID_BRUNO, id_inmueble: ID_CASA }
        ]);

        inmuebles.levantar();

        expect(contrato.Inquilino.nombres).toBe('Bruno');
        expect(contrato.Inmueble).toBeNull();
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

describe('Cuando ms-inmuebles no responde', () => {
    test('componer degrada a null, porque decorar no es autorizar', async () => {
        const url = process.env.MS_INMUEBLES_URL;
        process.env.MS_INMUEBLES_URL = 'http://127.0.0.1:1';

        const [contrato] = await adjuntarInmuebles([{ id_contrato: 'c1', id_inmueble: ID_CASA }]);
        expect(contrato.Inmueble).toBeNull();

        process.env.MS_INMUEBLES_URL = url;
    });

    test('pero AUTORIZAR propaga el fallo en vez de devolver lista vacía', async () => {
        // La distinción que sostiene todo el diseño del cliente. Una lista vacía
        // haría que un propietario viera «no tienes contratos»: una respuesta
        // creíble y falsa. Peor todavía, la disyunción de visibilidad quedaría
        // reducida a «eres el inquilino».
        const { idsDePropietario } = require('../src/clientes/inmuebles');
        const url = process.env.MS_INMUEBLES_URL;
        process.env.MS_INMUEBLES_URL = 'http://127.0.0.1:1';

        await expect(idsDePropietario(ID_ANA)).rejects.toThrow();

        process.env.MS_INMUEBLES_URL = url;
    });
});
