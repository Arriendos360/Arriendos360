const request = require('supertest');

const {
    app,
    cerrarEntorno,
    conToken,
    crearInquilino,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');
const { ESTADO_CONTRATO_FINALIZADO } = require('../src/models/constantes');

let token, idInmueble, idContrato;

beforeAll(async () => {
    await prepararEntorno();

    // Configuración inicial: Registro y Login
    const propietario = await registrarPropietario({
        email: 'full@test.com', contrasena: '123', documento: 'F1', nombres: 'F', apellidos: 'T'
    });
    token = propietario.token;

    // Crear datos base
    const resInm = await request(app).post('/api/inmuebles').set(...conToken(token)).send({ direccion: 'Dir 1', tipo: 'casa' });
    idInmueble = resInm.body.inmueble.id_inmueble;

    const inquilino = await crearInquilino(token, {
        email: 'inq@test.com', contrasena: '123', documento: 'I1', nombres: 'I', apellidos: 'T'
    });

    const resCon = await request(app).post('/api/contratos').set(...conToken(token)).send({
        id_inmueble: idInmueble, id_inquilino: inquilino.id, inicio: '2023-01-01', fin: '2023-12-31', canon: 500
    });
    idContrato = resCon.body.contrato.id_contrato;
});

afterAll(async () => { await cerrarEntorno(); });

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
        // 'finalizado', no 2: el estado dejo de ser un entero sin significado.
        expect(res.body.contrato.estado).toBe(ESTADO_CONTRATO_FINALIZADO);
    });
});

describe('Cobertura Total - Pagos', () => {
    test('POST /api/pagos/verificar-mora', async () => {
        // Crear una cuenta de cobro vencida manualmente. Ya no lleva
        // `saldo_pendiente`: el saldo se deriva de sus transacciones, y esta no
        // tiene ninguna, asi que vale su importe entero.
        const CuentaCobro = require('../src/models/CuentaCobro');
        await CuentaCobro.create({
            id_contrato: idContrato,
            detalle: 'Canon vencido de prueba',
            valor: 500,
            inicio: '2020-01-01',
            fin: '2020-01-31',
            estado: 'PENDIENTE'
        });

        const res = await request(app).post('/api/pagos/verificar-mora').set(...conToken(token));
        expect(res.statusCode).toBe(200);
        expect(res.body.pagos_actualizados).toBeGreaterThan(0);
    });

    test('GET /api/pagos/:id/recibo', async () => {
        const CuentaCobro = require('../src/models/CuentaCobro');
        const c = await CuentaCobro.findOne();
        const res = await request(app).get(`/api/pagos/${c.id_cuenta_cobro}/recibo`).set(...conToken(token));
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
