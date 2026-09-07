const request = require('supertest');

const {
    app,
    cerrarBase,
    conToken,
    crearInquilino,
    recrearBase,
    registrarPropietario
} = require('./utiles/entorno');

let token, idInmueble, idContrato;

beforeAll(async () => {
    await recrearBase();

    // Configuración inicial: Registro y Login
    const propietario = await registrarPropietario({
        email: 'full@test.com', contrasena: '123', documento: 'F1', nombres: 'F', apellidos: 'T'
    });
    token = propietario.token;

    // Crear datos base
    const resInm = await request(app).post('/api/inmuebles').set(...conToken(token)).send({ direccion: 'Dir 1' });
    idInmueble = resInm.body.inmueble.id_inmueble;

    const inquilino = await crearInquilino(token, {
        email: 'inq@test.com', contrasena: '123', documento: 'I1', nombres: 'I', apellidos: 'T'
    });

    const resCon = await request(app).post('/api/contratos').set(...conToken(token)).send({
        id_inmueble: idInmueble, id_inquilino: inquilino.id, fecha_inicio: '2023-01-01', fecha_fin: '2023-12-31', valor_mensual: 500
    });
    idContrato = resCon.body.contrato.id_contrato;
});

afterAll(async () => { await cerrarBase(); });

describe('Cobertura Total - Inmuebles', () => {
    test('GET /api/inmuebles', async () => {
        const res = await request(app).get('/api/inmuebles').set(...conToken(token));
        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
    });

    test('GET /api/inmuebles/:id', async () => {
        const res = await request(app).get(`/api/inmuebles/${idInmueble}`).set(...conToken(token));
        expect(res.statusCode).toBe(200);
        expect(res.body.direccion).toBe('Dir 1');
    });
});

describe('Cobertura Total - Contratos', () => {
    test('GET /api/contratos', async () => {
        const res = await request(app).get('/api/contratos').set(...conToken(token));
        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
    });

    test('PUT /api/contratos/:id/finalizar', async () => {
        const res = await request(app).put(`/api/contratos/${idContrato}/finalizar`).set(...conToken(token));
        expect(res.statusCode).toBe(200);
        expect(res.body.contrato.estado).toBe(2);
    });
});

describe('Cobertura Total - Pagos', () => {
    test('POST /api/pagos/verificar-mora', async () => {
        // Crear un pago vencido manualmente
        const Pago = require('../src/models/Pago');
        await Pago.create({ id_contrato: idContrato, monto_total: 500, saldo_pendiente: 500, mes_correspondiente: '2020-01-01', estado: 1 });
        
        const res = await request(app).post('/api/pagos/verificar-mora').set(...conToken(token));
        expect(res.statusCode).toBe(200);
        expect(res.body.pagos_actualizados).toBeGreaterThan(0);
    });

    test('GET /api/pagos/:id/recibo', async () => {
        const Pago = require('../src/models/Pago');
        const p = await Pago.findOne();
        const res = await request(app).get(`/api/pagos/${p.id_pago}/recibo`).set(...conToken(token));
        expect(res.statusCode).toBe(200);
        expect(res.header['content-type']).toBe('application/pdf');
    });
});

describe('Cobertura Total - Dashboard', () => {
    test('Endpoints de métricas', async () => {
        const routes = ['ingresos', 'mora', 'contratos-activos', 'resumen'];
        for (const route of routes) {
            const res = await request(app).get(`/api/dashboard/${route}`).set(...conToken(token));
            expect(res.statusCode).toBe(200);
        }
    });
});
