const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');

let tokenProp, idContrato;

beforeAll(async () => {
    await sequelize.sync({ force: true });

    // 1. Registrar Propietario
    await request(app).post('/api/auth/register').send({
        correo: 'prop@pago.com',
        contrasena: 'pass123',
        rol: 'propietario',
        documento: 'P123',
        nombres: 'Prop',
        apellidos: 'Pago'
    });
    const login = await request(app).post('/api/auth/login').send({
        correo: 'prop@pago.com',
        contrasena: 'pass123'
    });
    tokenProp = login.body.token;

    // 2. Registrar Inquilino
    await request(app).post('/api/auth/register').send({
        correo: 'inq@pago.com',
        contrasena: 'pass123',
        rol: 'inquilino',
        documento: 'I123',
        nombres: 'Inq',
        apellidos: 'Pago'
    });

    // 3. Crear Inmueble
    const resInm = await request(app)
        .post('/api/inmuebles')
        .set('Authorization', `Bearer ${tokenProp}`)
        .send({ direccion: 'Calle Pago 1', tipo_inmueble: 'Apto' });
    const idInm = resInm.body.inmueble.id_inmueble;

    // 4. Crear Contrato
    const resCon = await request(app)
        .post('/api/contratos')
        .set('Authorization', `Bearer ${tokenProp}`)
        .send({
            id_inmueble: idInm,
            id_inquilino: 'I123',
            fecha_inicio: '2023-01-01',
            fecha_fin: '2023-12-31',
            valor_mensual: 1200
        });
    idContrato = resCon.body.contrato.id_contrato;
});

afterAll(async () => {
    await sequelize.close();
});

describe('Gestión de Pagos', () => {
    let idPago;

    test('Debería crear un cobro (pago pendiente)', async () => {
        const response = await request(app)
            .post('/api/pagos')
            .set('Authorization', `Bearer ${tokenProp}`)
            .send({
                id_contrato: idContrato,
                monto_total: 1200,
                mes_correspondiente: '2023-01-01'
            });
        
        expect(response.statusCode).toBe(201);
        expect(response.body.pago.saldo_pendiente).toBe("1200.00");
        idPago = response.body.pago.id_pago;
    });

    test('Debería registrar un pago realizado', async () => {
        const response = await request(app)
            .put(`/api/pagos/${idPago}/pagar`)
            .set('Authorization', `Bearer ${tokenProp}`)
            .send({
                monto_pagado: 1200,
                tipo_transaccion: 'Efectivo',
                observaciones: 'Pago puntual'
            });
        
        expect(response.statusCode).toBe(200);
        expect(response.body.pago.estado).toBe(2); // Pagado
        expect(parseFloat(response.body.pago.saldo_pendiente)).toBe(0);
    });
});

describe('Dashboard', () => {
    test('Debería retornar resumen con ingresos', async () => {
        const response = await request(app)
            .get('/api/dashboard/resumen')
            .set('Authorization', `Bearer ${tokenProp}`);
        
        expect(response.statusCode).toBe(200);
        expect(parseFloat(response.body.ingresos_totales)).toBe(1200);
    });
});
