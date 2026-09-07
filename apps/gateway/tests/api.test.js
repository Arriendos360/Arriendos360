const request = require('supertest');

const { app, cerrarBase, recrearBase, registrarPropietario } = require('./utiles/entorno');

beforeAll(async () => {
    await recrearBase();
});

afterAll(async () => {
    await cerrarBase();
});

describe('API Básica', () => {
    test('Debería responder en la ruta raíz', async () => {
        const response = await request(app).get('/');
        expect(response.statusCode).toBe(200);
        expect(response.body.mensaje).toContain('API Arriendos360');
    });
});

describe('Autenticación', () => {
    // El contrato del Capítulo 2: `email` en vez de `correo`, y sin campo `rol`
    // (el registro público siempre crea PROPIETARIO).
    const usuarioPrueba = {
        email: 'test_unit@example.com',
        contrasena: 'password123',
        nombres: 'Test',
        apellidos: 'User',
        telefono: '1234567',
        documento: '999888'
    };

    test('Debería registrar un nuevo usuario', async () => {
        const response = await request(app)
            .post('/api/auth/registro')
            .send(usuarioPrueba);

        expect(response.statusCode).toBe(201);
        expect(response.body.usuario.email).toBe(usuarioPrueba.email);
        expect(response.body.usuario.rol).toBe('PROPIETARIO');
    });

    test('Debería hacer login exitoso', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({
                email: usuarioPrueba.email,
                contrasena: usuarioPrueba.contrasena
            });

        expect(response.statusCode).toBe(200);
        expect(response.body.token).toBeDefined();
        expect(response.body.usuario.rol).toBe('PROPIETARIO');
    });

    test('La respuesta del login trae token, tipo_token, expiracion y usuario', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: usuarioPrueba.email, contrasena: usuarioPrueba.contrasena });

        expect(response.body.tipo_token).toBe('Bearer');
        expect(typeof response.body.expiracion).toBe('string');
        // Una hora, con margen para el tiempo de ejecución de la prueba.
        const faltan = (new Date(response.body.expiracion) - Date.now()) / 1000;
        expect(faltan).toBeGreaterThan(3500);
        expect(faltan).toBeLessThanOrEqual(3600);

        expect(response.body.usuario.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    });

    test('No debería permitir login con contraseña incorrecta', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({
                email: usuarioPrueba.email,
                contrasena: 'wrongpassword'
            });

        expect(response.statusCode).toBe(401);
    });

    test('No debería permitir dos usuarios con el mismo documento', async () => {
        const response = await request(app).post('/api/auth/registro').send({
            ...usuarioPrueba,
            email: 'otro_email@example.com'
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.mensaje).toContain('documento');
    });

    test('El registro público no acepta el rol desde el cuerpo', async () => {
        // Aunque el cliente mande `rol: 'INQUILINO'`, se ignora: la asignación en
        // RolesUsuario se maneja internamente.
        const { login } = await registrarPropietario({
            email: 'intruso@example.com',
            documento: '777666',
            nombres: 'Intruso',
            apellidos: 'Prueba',
            rol: 'INQUILINO'
        });

        expect(login.body.usuario.roles).toEqual(['PROPIETARIO']);
    });
});
