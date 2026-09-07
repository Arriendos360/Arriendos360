const request = require('supertest');

const {
    app,
    cerrarEntorno,
    conToken,
    crearInquilino,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');

let tokenOwner1, tokenOwner2, idInmuebleOwner1, idInquilino;

beforeAll(async () => {
    await prepararEntorno();

    const owner1 = await registrarPropietario({
        email: 'owner1@test.com',
        nombres: 'Owner',
        apellidos: 'One',
        documento: '111'
    });
    tokenOwner1 = owner1.token;

    const owner2 = await registrarPropietario({
        email: 'owner2@test.com',
        nombres: 'Owner',
        apellidos: 'Two',
        documento: '222'
    });
    tokenOwner2 = owner2.token;

    // El inquilino lo da de alta un propietario: el registro público quedó fijado
    // a PROPIETARIO por el contrato de interfaz.
    const inquilino = await crearInquilino(tokenOwner1, {
        email: 'inq@test.com',
        nombres: 'Inq',
        apellidos: 'Test',
        documento: '333'
    });
    idInquilino = inquilino.id;

    const resInm = await request(app)
        .post('/api/inmuebles')
        .set(...conToken(tokenOwner1))
        .send({
            direccion: 'Calle Falsa 123',
            tipo_inmueble: 'Casa'
        });
    idInmuebleOwner1 = resInm.body.inmueble.id_inmueble;
});

afterAll(async () => {
    await cerrarEntorno();
});

describe('Seguridad de Inmuebles', () => {
    test('Owner 2 no debería poder ver los detalles del inmueble de Owner 1', async () => {
        const response = await request(app)
            .get(`/api/inmuebles/${idInmuebleOwner1}`)
            .set(...conToken(tokenOwner2));

        expect(response.statusCode).toBe(404);
        expect(response.body.mensaje).toContain('no tienes permisos');
    });

    test('Owner 2 no debería poder actualizar el inmueble de Owner 1', async () => {
        const response = await request(app)
            .put(`/api/inmuebles/${idInmuebleOwner1}`)
            .set(...conToken(tokenOwner2))
            .send({ direccion: 'Hackeado' });

        expect(response.statusCode).toBe(404); // Retorna 404 por el filtro de propiedad
        expect(response.body.mensaje).toContain('no tienes permisos');
    });

    test('Owner 2 no debería poder eliminar el inmueble de Owner 1', async () => {
        const response = await request(app)
            .delete(`/api/inmuebles/${idInmuebleOwner1}`)
            .set(...conToken(tokenOwner2));

        expect(response.statusCode).toBe(404);
    });

    test('Un inquilino ni siquiera llega al listado: lo corta la matriz RBAC', async () => {
        // Autorización en dos niveles (regla dura 8). Este es el primero: la
        // matriz del gateway declara todo /api/inmuebles como PROPIETARIO, así
        // que la petición se deniega antes de tocar el controlador.
        //
        // Antes de la matriz esta prueba esperaba 200 con lista vacía, porque la
        // única defensa era el filtro del controlador (ver docs/adr/0005). Ese
        // filtro sigue ahí y sigue haciendo falta: es el segundo nivel, y es el
        // que separa a un propietario de otro. Lo comprueba la prueba siguiente.
        const login = await request(app)
            .post('/api/auth/login')
            .send({ email: 'inq@test.com', contrasena: 'pass123' });

        const response = await request(app)
            .get('/api/inmuebles')
            .set(...conToken(login.body.token));

        expect(response.statusCode).toBe(403);
    });

    test('Un propietario sin inmuebles recibe lista vacía, no los de otros', async () => {
        // El segundo nivel: ABAC de pertenencia en el controlador. Owner 2 pasa
        // la matriz porque su rol es el correcto; lo que lo detiene es que los
        // inmuebles no son suyos.
        const response = await request(app)
            .get('/api/inmuebles')
            .set(...conToken(tokenOwner2));

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual([]);
    });
});

describe('Seguridad de Contratos', () => {
    test('Owner 2 no debería poder crear un contrato para un inmueble de Owner 1', async () => {
        const response = await request(app)
            .post('/api/contratos')
            .set(...conToken(tokenOwner2))
            .send({
                id_inmueble: idInmuebleOwner1,
                id_inquilino: idInquilino,
                fecha_inicio: '2023-01-01',
                fecha_fin: '2023-12-31',
                valor_mensual: 1000
            });

        expect(response.statusCode).toBe(403);
        expect(response.body.mensaje).toContain('No tienes permisos');
    });

    test('Un id_inquilino que no es UUID responde 404, no 500', async () => {
        // Regresión del paso a UUID: antes `id_inquilino` era la cédula. Si
        // llega una cédula vieja, PostgreSQL rechazaría el tipo y Sequelize lo
        // propagaría como 500. Tiene que ser el 404 de "inquilino no encontrado".
        const response = await request(app)
            .post('/api/contratos')
            .set(...conToken(tokenOwner1))
            .send({
                id_inmueble: idInmuebleOwner1,
                id_inquilino: '333',
                fecha_inicio: '2023-01-01',
                fecha_fin: '2023-12-31',
                valor_mensual: 1000
            });

        expect(response.statusCode).toBe(404);
        expect(response.body.error_code).toBe('TENANT_NOT_FOUND');
    });
});

describe('Autorización del token', () => {
    test('Sin token responde 401', async () => {
        const response = await request(app).get('/api/inmuebles');
        expect(response.statusCode).toBe(401);
        expect(response.body.mensaje).toContain('No se proporcionó un token');
    });

    test('Con token inválido responde 403', async () => {
        const response = await request(app)
            .get('/api/inmuebles')
            .set('Authorization', 'Bearer token-de-mentira');

        expect(response.statusCode).toBe(403);
        expect(response.body.mensaje).toContain('Token no válido');
    });

    test('Una cabecera sin el esquema Bearer responde 401', async () => {
        const response = await request(app)
            .get('/api/inmuebles')
            .set('Authorization', tokenOwner1);

        expect(response.statusCode).toBe(401);
    });

    test('El parámetro ?token= ya no autentica', async () => {
        // Se eliminó junto con `window.open`: un token en la query string queda
        // en los logs, en el historial del navegador y en la cabecera Referer.
        const response = await request(app).get(`/api/inmuebles?token=${tokenOwner1}`);

        expect(response.statusCode).toBe(401);
    });
});
