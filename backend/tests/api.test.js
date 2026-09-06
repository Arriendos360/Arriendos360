const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');

beforeAll(async () => {
    // Sincronizar base de datos de prueba
    await sequelize.sync({ force: true });
});

afterAll(async () => {
    await sequelize.close();
});

describe('API Básica', () => {
    test('Debería responder en la ruta raíz', async () => {
        const response = await request(app).get('/');
        expect(response.statusCode).toBe(200);
        expect(response.body.mensaje).toContain('API Arriendos360');
    });
});

describe('Autenticación', () => {
    const usuarioPrueba = {
        correo: 'test_unit@example.com',
        contrasena: 'password123',
        rol: 'propietario',
        nombres: 'Test',
        apellidos: 'User',
        telefono: '1234567',
        documento: '999888'
    };

    test('Debería registrar un nuevo usuario', async () => {
        const response = await request(app)
            .post('/api/auth/register')
            .send(usuarioPrueba);
        
        expect(response.statusCode).toBe(201);
        expect(response.body.usuario.correo).toBe(usuarioPrueba.correo);
    });

    test('Debería hacer login exitoso', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({
                correo: usuarioPrueba.correo,
                contrasena: usuarioPrueba.contrasena
            });
        
        expect(response.statusCode).toBe(200);
        expect(response.body.token).toBeDefined();
        expect(response.body.usuario.rol).toBe('propietario');
    });

    test('No debería permitir login con contraseña incorrecta', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({
                correo: usuarioPrueba.correo,
                contrasena: 'wrongpassword'
            });
        
        expect(response.statusCode).toBe(401);
    });
});
