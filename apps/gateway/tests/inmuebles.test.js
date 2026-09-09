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
 *
 * Desde el paso 5, lo segundo ya no ocurre dentro de la petición: firmar un
 * contrato anota un evento y el estado del inmueble lo mueve el consumidor
 * cuando el publicador se lo entrega. Por eso estas pruebas llaman a
 * `entregarEventos()` donde antes no hacía falta nada — y por eso comprueban
 * también el instante intermedio, que es la ventana de convergencia que el
 * diseño acepta. El mecanismo en sí se prueba en `eventos.test.js`.
 */

const request = require('supertest');

const {
    CONTRASENA_POR_DEFECTO,
    app,
    cerrarEntorno,
    conToken,
    crearInmueble,
    crearInquilino,
    entregarEventos,
    iniciarSesion,
    inmueblesFalso,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');
const { USUARIO_SISTEMA } = require('./dobles/inmuebles');

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
            inicio: '2023-01-01',
            fin: '2023-12-31',
            canon: 1000
        });

    return { idInmueble, idContrato: respuesta.body.contrato?.id_contrato, respuesta };
};

describe('El estado del inmueble lo mueve el contrato', () => {
    test('firmar un contrato deja el inmueble arrendado, tras la entrega', async () => {
        const { idInmueble, respuesta } = await contratoSobreInmuebleNuevo('Estado 1');

        expect(respuesta.statusCode).toBe(201);

        // ANTES de entregar, el inmueble sigue libre. No es un defecto: es la
        // ventana de convergencia, y dejarla escrita es lo que impide que
        // alguien la descubra en la demostración.
        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('disponible');

        await entregarEventos();

        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('arrendado');
    });

    test('la respuesta ya no lleva aviso: no hay nada que se pueda perder', async () => {
        // Con la llamada síncrona, el `201` podía venir con un aviso de «el
        // contrato quedó pero el inmueble no se pudo marcar». Ahora el evento
        // está en disco dentro de la misma transacción, así que no existe el
        // caso que aquel aviso describía.
        const { respuesta } = await contratoSobreInmuebleNuevo('Estado 2');

        expect(respuesta.body.aviso).toBeUndefined();
    });

    test('la auditoría del cambio registra al sistema, no a la persona', async () => {
        // Cambio respecto del ADR 0011, y deliberado. El sobre del evento no
        // lleva actor: describe un hecho del dominio de quien lo emite, no la
        // petición de una persona a ms-inmuebles. Quién firmó queda registrado
        // en el contrato, que es donde importa.
        const { idInmueble } = await contratoSobreInmuebleNuevo('Estado 3');
        await entregarEventos();

        expect(inmueblesFalso().inmuebles.get(idInmueble).actualizado_por).toBe(USUARIO_SISTEMA);
    });

    test('finalizar el contrato lo libera', async () => {
        const { idInmueble, idContrato } = await contratoSobreInmuebleNuevo('Estado 4');
        await entregarEventos();

        const respuesta = await request(app)
            .put(`/api/contratos/${idContrato}/finalizar`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(200);
        expect(respuesta.body.aviso).toBeUndefined();

        await entregarEventos();

        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('disponible');
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

// AQUI ESTABA `describe('Los pagos y abonos siguen trayendo el inmueble de su
// contrato')`. Se fue con ms-financiero en el paso 6e, y no porque sobrara: la
// regresion que vigilaba sigue siendo real —la pantalla de Pagos imprime
// `cuenta.Contrato.Inmueble.direccion`, y al quitar Inmuebles de aquel `include`
// la columna paso a mostrar el UUID en crudo, con la API respondiendo 200—.
//
// Lo que cambio es quien compone esa ruta. Ya no la compone el gateway: la
// compone ms-financiero pidiendole el contrato a ms-contratos con
// `incluir=inmueble`. Probarla aqui seria probar el doble.
//
// Vive ahora en `services/ms-financiero/tests/pagos.test.ts`, en «la lista trae
// el contrato y su inmueble compuestos».

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
