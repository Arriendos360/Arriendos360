const request = require('supertest');

const {
    app,
    cerrarEntorno,
    conToken,
    crearInquilino,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');
const { ESTADO_CONTRATO_FINALIZADO } = require('../src/constantes');

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

// AQUI ESTABA `describe('Cobertura Total - Pagos')`. Se fue con ms-financiero en
// el paso 6e, y no podia quedarse: llegaba a la tabla con
// `require('../src/models/CuentaCobro')` para sembrar una cuenta vencida, y esa
// tabla ya no esta en la base del gateway. Reescribirla contra el doble habria
// sido probar el doble.
//
// Los dos casos que cubria viven ahora en el servicio:
//
//   - `POST /api/pagos/verificar-mora`  ->  `tests/pagos.test.ts`, en el bloque
//     «verificar-mora aplica la MISMA regla que el motor», que ademas cierra la
//     trampa de las dos reglas distintas que CLAUDE.md tenia anotada.
//   - `GET /api/pagos/:id/recibo`       ->  `tests/comprobantes.test.ts`, que
//     comprueba el PDF entero y no solo su `content-type`.

describe('Cobertura Total - Dashboard', () => {
    test('Endpoints de métricas', async () => {
        const routes = ['ingresos', 'mora', 'contratos-activos', 'resumen'];
        for (const route of routes) {
            const res = await request(app).get(`/api/dashboard/${route}`).set(...conToken(token));
            expect(res.statusCode).toBe(200);
        }
    });
});
