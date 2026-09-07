/**
 * Lo que el gateway sigue decidiendo sobre inmuebles después de extraerlos.
 *
 * El CRUD ya no es suyo: la costura lo reenvía a ms-inmuebles y allí se prueba
 * (`services/ms-inmuebles/tests/`). Lo que queda aquí son las tres cosas que
 * ningún servicio puede resolver solo:
 *
 * 1. El veto de borrado con contrato activo, que depende de Contratos.
 * 2. El estado del inmueble, que lo mueve el ciclo de vida del contrato.
 * 3. Que la composición sustituya al `include` sin cambiar lo observable.
 */

const request = require('supertest');

const {
    app,
    cerrarEntorno,
    conToken,
    crearInmueble,
    crearInquilino,
    inmueblesFalso,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');

let tokenProp;
let idProp;
let idInquilino;

beforeAll(async () => {
    await prepararEntorno();

    const propietario = await registrarPropietario({
        email: 'prop@inm.com',
        nombres: 'Prop',
        apellidos: 'Inmueble',
        documento: 'PI1'
    });
    tokenProp = propietario.token;
    idProp = propietario.id;

    const inquilino = await crearInquilino(tokenProp, {
        email: 'inq@inm.com',
        nombres: 'Inq',
        apellidos: 'Inmueble',
        documento: 'II1'
    });
    idInquilino = inquilino.id;
});

afterAll(async () => {
    await cerrarEntorno();
});

/** Firma un contrato sobre un inmueble recién creado y devuelve los dos ids. */
const contratoSobreInmuebleNuevo = async (direccion) => {
    const { id: idInmueble } = await crearInmueble(tokenProp, { direccion });

    const respuesta = await request(app)
        .post('/api/contratos')
        .set(...conToken(tokenProp))
        .send({
            id_inmueble: idInmueble,
            id_inquilino: idInquilino,
            fecha_inicio: '2023-01-01',
            fecha_fin: '2023-12-31',
            valor_mensual: 1000
        });

    return { idInmueble, idContrato: respuesta.body.contrato?.id_contrato, respuesta };
};

describe('El estado del inmueble lo mueve el contrato', () => {
    test('firmar un contrato deja el inmueble arrendado', async () => {
        const { idInmueble, respuesta } = await contratoSobreInmuebleNuevo('Estado 1');

        expect(respuesta.statusCode).toBe(201);
        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('arrendado');
    });

    test('la auditoría del cambio registra a la persona, no al servicio', async () => {
        // El `iss` del token de servicio sería "gateway", que ni es un UUID ni
        // es el dato que importa auditar.
        const { idInmueble } = await contratoSobreInmuebleNuevo('Estado 2');

        expect(inmueblesFalso().inmuebles.get(idInmueble).actualizado_por).toBe(idProp);
    });

    test('finalizar el contrato lo libera', async () => {
        const { idInmueble, idContrato } = await contratoSobreInmuebleNuevo('Estado 3');

        const respuesta = await request(app)
            .put(`/api/contratos/${idContrato}/finalizar`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(200);
        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('disponible');
    });
});

describe('Cuando el cambio de estado falla, se dice', () => {
    test('el contrato queda creado y la respuesta lleva un aviso', async () => {
        // Aquí se pierde la atomicidad que daba la transacción del monolito, y
        // el punto de esta prueba es que NO se finge lo contrario. Ver
        // docs/adr/0011: el contrato es el hecho de negocio y no se deshace
        // porque su reflejo no haya podido escribirse.
        const { id: idInmueble } = await crearInmueble(tokenProp, { direccion: 'Se cae al marcar' });

        // Solo se tira la ESCRITURA del estado. La consulta de pertenencia
        // sigue en pie, que es lo que permite llegar hasta el punto que
        // interesa: el contrato ya guardado y el reflejo sin escribir.
        inmueblesFalso().caer(503, /\/estado$/);

        const respuesta = await request(app)
            .post('/api/contratos')
            .set(...conToken(tokenProp))
            .send({
                id_inmueble: idInmueble,
                id_inquilino: idInquilino,
                fecha_inicio: '2023-01-01',
                fecha_fin: '2023-12-31',
                valor_mensual: 1000
            });

        inmueblesFalso().levantar();

        expect(respuesta.statusCode).toBe(201);
        expect(respuesta.body.contrato).toBeDefined();
        expect(respuesta.body.aviso).toContain('estado del inmueble');

        // Y el contrato existe de verdad, no es solo la respuesta.
        const Contrato = require('../src/models/Contrato');
        const guardado = await Contrato.findByPk(respuesta.body.contrato.id_contrato);
        expect(guardado).not.toBeNull();
    });
});

describe('Borrado de un inmueble con contrato activo', () => {
    let idConContrato;
    let idContrato;

    beforeAll(async () => {
        const creado = await contratoSobreInmuebleNuevo('No me borres');
        idConContrato = creado.idInmueble;
        idContrato = creado.idContrato;
    });

    test('responde 409, no 403', async () => {
        // No es un problema de permisos —el inmueble es suyo y su rol es el
        // correcto— sino del estado del recurso. Un 403 le diría al propietario
        // que no tiene derecho sobre su propio inmueble, que es falso y además
        // no le dice qué hacer.
        const respuesta = await request(app)
            .delete(`/api/inmuebles/${idConContrato}`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(409);
        expect(respuesta.body.mensaje).toContain('contrato activo');
    });

    test('la petición NO llega a ms-inmuebles', async () => {
        // El veto es del gateway y corta antes de la costura: el inmueble no
        // debe salir a la red interna para que lo rechacen allí.
        inmueblesFalso().llamadas.length = 0;

        await request(app)
            .delete(`/api/inmuebles/${idConContrato}`)
            .set(...conToken(tokenProp));

        const borrados = inmueblesFalso().llamadas.filter((l) => l.metodo === 'DELETE');
        expect(borrados).toHaveLength(0);
    });

    test('y el inmueble sigue existiendo', () => {
        expect(inmueblesFalso().inmuebles.has(idConContrato)).toBe(true);
    });

    test('tras finalizar el contrato, el borrado pasa', async () => {
        await request(app)
            .put(`/api/contratos/${idContrato}/finalizar`)
            .set(...conToken(tokenProp));

        const respuesta = await request(app)
            .delete(`/api/inmuebles/${idConContrato}`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(200);
        expect(inmueblesFalso().inmuebles.has(idConContrato)).toBe(false);
    });

    test('un inmueble sin contratos se borra sin más', async () => {
        const { id } = await crearInmueble(tokenProp, { direccion: 'Libre' });

        const respuesta = await request(app)
            .delete(`/api/inmuebles/${id}`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(200);
    });

    test('un id con forma inválida lo resuelve ms-inmuebles, no el guardia', async () => {
        // El guardia lo deja pasar a propósito: no le corresponde adivinar
        // respuestas que son del servicio.
        const respuesta = await request(app)
            .delete('/api/inmuebles/no-soy-un-uuid')
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(404);
    });
});

describe('El CRUD sigue funcionando a través de la costura', () => {
    test('crear devuelve 201 con el inmueble del propietario', async () => {
        const { respuesta, id } = await crearInmueble(tokenProp, { direccion: 'Por la costura' });

        expect(respuesta.statusCode).toBe(201);
        expect(respuesta.body.inmueble.id_propietario).toBe(idProp);
        expect(id).toBeDefined();
    });

    test('un tipo fuera del catálogo devuelve 400', async () => {
        const respuesta = await request(app)
            .post('/api/inmuebles')
            .set(...conToken(tokenProp))
            .send({ direccion: 'X', tipo: 'Casa' });

        expect(respuesta.statusCode).toBe(400);
    });

    test('un propietario ajeno recibe 404 sobre un inmueble que no es suyo', async () => {
        const otro = await registrarPropietario({
            email: 'otro@inm.com',
            nombres: 'Otro',
            apellidos: 'Prop',
            documento: 'OP1'
        });

        const { id } = await crearInmueble(tokenProp, { direccion: 'Mío' });

        const respuesta = await request(app)
            .get(`/api/inmuebles/${id}`)
            .set(...conToken(otro.token));

        expect(respuesta.statusCode).toBe(404);
    });
});

describe('Los contratos siguen trayendo su inmueble', () => {
    test('el listado compone el Inmueble como lo hacía el include', async () => {
        const { idInmueble } = await contratoSobreInmuebleNuevo('Compuesta');

        const respuesta = await request(app)
            .get('/api/contratos')
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(200);

        const contrato = respuesta.body.find((c) => c.id_inmueble === idInmueble);
        expect(contrato.Inmueble.direccion).toBe('Compuesta');
        // Y el inquilino sigue viniendo de ms-identidad, en la misma respuesta.
        expect(contrato.Inquilino.email).toBe('inq@inm.com');
    });

    test('si ms-inmuebles no responde, el listado da 502 y no una lista vacía', async () => {
        // Autorizar no se degrada: una lista vacía sería una respuesta creíble
        // y falsa. Ver la cabecera de `clientes/inmuebles.js`.
        inmueblesFalso().caer();

        const respuesta = await request(app)
            .get('/api/contratos')
            .set(...conToken(tokenProp));

        inmueblesFalso().levantar();

        expect(respuesta.statusCode).toBe(502);
    });
});
