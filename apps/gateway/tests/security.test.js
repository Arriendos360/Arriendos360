const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');

let tokenOwner1, tokenOwner2, idInmuebleOwner1;

beforeAll(async () => {
    await sequelize.sync({ force: true });

    // Registrar y loguear Propietario 1
    await request(app).post('/api/auth/register').send({
        correo: 'owner1@test.com',
        contrasena: 'pass123',
        rol: 'propietario',
        nombres: 'Owner',
        apellidos: 'One',
        documento: '111'
    });
    const login1 = await request(app).post('/api/auth/login').send({
        correo: 'owner1@test.com',
        contrasena: 'pass123'
    });
    tokenOwner1 = login1.body.token;

    // Registrar y loguear Propietario 2
    await request(app).post('/api/auth/register').send({
        correo: 'owner2@test.com',
        contrasena: 'pass123',
        rol: 'propietario',
        nombres: 'Owner',
        apellidos: 'Two',
        documento: '222'
    });
    const login2 = await request(app).post('/api/auth/login').send({
        correo: 'owner2@test.com',
        contrasena: 'pass123'
    });
    tokenOwner2 = login2.body.token;

    // Crear un inmueble para Owner 1
    const resInm = await request(app)
        .post('/api/inmuebles')
        .set('Authorization', `Bearer ${tokenOwner1}`)
        .send({
            direccion: 'Calle Falsa 123',
            tipo_inmueble: 'Casa'
        });
    idInmuebleOwner1 = resInm.body.inmueble.id_inmueble;
});

afterAll(async () => {
    await sequelize.close();
});

describe('Seguridad de Inmuebles', () => {
    test('Owner 2 no debería poder ver los detalles del inmueble de Owner 1', async () => {
        const response = await request(app)
            .get(`/api/inmuebles/${idInmuebleOwner1}`)
            .set('Authorization', `Bearer ${tokenOwner2}`);
        
        expect(response.statusCode).toBe(404);
        expect(response.body.mensaje).toContain('no tienes permisos');
    });

    test('Owner 2 no debería poder actualizar el inmueble de Owner 1', async () => {
        const response = await request(app)
            .put(`/api/inmuebles/${idInmuebleOwner1}`)
            .set('Authorization', `Bearer ${tokenOwner2}`)
            .send({ direccion: 'Hackeado' });
        
        expect(response.statusCode).toBe(404); // Retorna 404 por el filtro de propiedad
        expect(response.body.mensaje).toContain('no tienes permisos');
    });

    test('Owner 2 no debería poder eliminar el inmueble de Owner 1', async () => {
        const response = await request(app)
            .delete(`/api/inmuebles/${idInmuebleOwner1}`)
            .set('Authorization', `Bearer ${tokenOwner2}`);
        
        expect(response.statusCode).toBe(404);
    });
});

describe('Seguridad de Contratos', () => {
    test('Owner 2 no debería poder crear un contrato para un inmueble de Owner 1', async () => {
        // Primero registrar un inquilino
        await request(app).post('/api/auth/register').send({
            correo: 'inq@test.com',
            contrasena: 'pass123',
            rol: 'inquilino',
            nombres: 'Inq',
            apellidos: 'Test',
            documento: '333'
        });

        const response = await request(app)
            .post('/api/contratos')
            .set('Authorization', `Bearer ${tokenOwner2}`)
            .send({
                id_inmueble: idInmuebleOwner1,
                id_inquilino: '333',
                fecha_inicio: '2023-01-01',
                fecha_fin: '2023-12-31',
                valor_mensual: 1000
            });
        
        expect(response.statusCode).toBe(403);
        expect(response.body.mensaje).toContain('No tienes permisos');
    });
});
