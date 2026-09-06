const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');

let tokenProp, idContrato, idPago;

beforeAll(async () => {
    await sequelize.sync({ force: true });

    // 1. Registrar Propietario
    await request(app).post('/api/auth/register').send({
        correo: 'prop@abono.com', contrasena: 'pass123', rol: 'propietario', documento: 'P_ABONO', nombres: 'Prop', apellidos: 'Abono'
    });
    const login = await request(app).post('/api/auth/login').send({
        correo: 'prop@abono.com', contrasena: 'pass123'
    });
    tokenProp = login.body.token;

    // 2. Registrar Inquilino
    await request(app).post('/api/auth/register').send({
        correo: 'inq@abono.com', contrasena: 'pass123', rol: 'inquilino', documento: 'I_ABONO', nombres: 'Inq', apellidos: 'Abono'
    });

    // 3. Crear Inmueble y Contrato
    const resInm = await request(app).post('/api/inmuebles').set('Authorization', `Bearer ${tokenProp}`).send({ direccion: 'Abono Street', tipo_inmueble: 'Casa' });
    const resCon = await request(app).post('/api/contratos').set('Authorization', `Bearer ${tokenProp}`).send({
        id_inmueble: resInm.body.inmueble.id_inmueble, id_inquilino: 'I_ABONO', fecha_inicio: '2023-01-01', fecha_fin: '2023-12-31', valor_mensual: 1000
    });
    idContrato = resCon.body.contrato.id_contrato;

    // 4. Generar cobro inicial
    const resPago = await request(app).post('/api/pagos').set('Authorization', `Bearer ${tokenProp}`).send({
        id_contrato: idContrato, monto_total: 1000, mes_correspondiente: '2023-01-01'
    });
    idPago = resPago.body.pago.id_pago;
});

afterAll(async () => { await sequelize.close(); });

describe('RF-17 & RF-18: Gestión de Abonos', () => {
    test('Debería registrar un abono parcial y cambiar estado a Pago Parcial', async () => {
        const response = await request(app)
            .put(`/api/pagos/${idPago}/pagar`)
            .set('Authorization', `Bearer ${tokenProp}`)
            .send({ monto_pagado: 400, tipo_transaccion: 'Transferencia', observaciones: 'Primer abono' });
        
        expect(response.statusCode).toBe(200);
        expect(parseFloat(response.body.pago.saldo_pendiente)).toBe(600);
        expect(response.body.pago.estado).toBe(4); // 4 = Pago Parcial
        expect(parseFloat(response.body.abono.monto)).toBe(400);
    });

    test('Debería bloquear un sobrepago (monto > saldo pendiente)', async () => {
        const response = await request(app)
            .put(`/api/pagos/${idPago}/pagar`)
            .set('Authorization', `Bearer ${tokenProp}`)
            .send({ monto_pagado: 700 }); // Saldo es 600
        
        expect(response.statusCode).toBe(400);
        expect(response.body.mensaje).toContain('Monto inválido o superior al saldo');
    });

    test('Debería completar el pago al llegar a saldo cero', async () => {
        const response = await request(app)
            .put(`/api/pagos/${idPago}/pagar`)
            .set('Authorization', `Bearer ${tokenProp}`)
            .send({ monto_pagado: 600 });
        
        expect(response.statusCode).toBe(200);
        expect(parseFloat(response.body.pago.saldo_pendiente)).toBe(0);
        expect(response.body.pago.estado).toBe(2); // 2 = Pagado
    });

    test('Debería poder ver el historial de abonos', async () => {
        const response = await request(app)
            .get(`/api/pagos/${idPago}/abonos`)
            .set('Authorization', `Bearer ${tokenProp}`);
        
        expect(response.statusCode).toBe(200);
        expect(response.body.length).toBe(2);
    });

    test('RF-18: Debería obtener un comprobante de abono específico', async () => {
        const resAbonos = await request(app).get(`/api/pagos/${idPago}/abonos`).set('Authorization', `Bearer ${tokenProp}`);
        const idAbono = resAbonos.body[0].id_abono;

        const response = await request(app)
            .get(`/api/pagos/abono/${idAbono}`)
            .set('Authorization', `Bearer ${tokenProp}`);

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toBe('application/pdf');
        expect(response.body instanceof Buffer).toBe(true);
    });
});
