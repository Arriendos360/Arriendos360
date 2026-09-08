const request = require('supertest');

const { ESTADO_CUENTA_PAGADA, ESTADO_CUENTA_PENDIENTE } = require('../src/models/constantes');
const {
    app,
    cerrarEntorno,
    conToken,
    crearInquilino,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');

/**
 * Cuentas de cobro, de punta a punta por la API.
 *
 * Las dos rutas que ejercita son las que el paso 6c reorganizo:
 * `POST /api/pagos/cuentas-cobro` emite el cobro y `POST /api/pagos` registra
 * el dinero que entra contra el, con el cuerpo del Capitulo 2. Antes eran
 * `POST /api/pagos` y `PUT /api/pagos/:id/pagar`.
 */

let tokenProp, idContrato;

beforeAll(async () => {
    await prepararEntorno();

    // 1. Registrar Propietario
    const propietario = await registrarPropietario({
        email: 'prop@pago.com',
        documento: 'P123',
        nombres: 'Prop',
        apellidos: 'Pago'
    });
    tokenProp = propietario.token;

    // 2. Dar de alta al Inquilino
    const inquilino = await crearInquilino(tokenProp, {
        email: 'inq@pago.com',
        documento: 'I123',
        nombres: 'Inq',
        apellidos: 'Pago'
    });

    // 3. Crear Inmueble
    const resInm = await request(app)
        .post('/api/inmuebles')
        .set(...conToken(tokenProp))
        .send({ direccion: 'Calle Pago 1', tipo: 'apartamento' });
    const idInm = resInm.body.inmueble.id_inmueble;

    // 4. Crear Contrato
    const resCon = await request(app)
        .post('/api/contratos')
        .set(...conToken(tokenProp))
        .send({
            id_inmueble: idInm,
            id_inquilino: inquilino.id,
            inicio: '2023-01-01',
            fin: '2023-12-31',
            canon: 1200
        });
    idContrato = resCon.body.contrato.id_contrato;
});

afterAll(async () => {
    await cerrarEntorno();
});

describe('Gestión de Cuentas de cobro', () => {
    let idCuenta;

    test('Debería emitir una cuenta de cobro con periodo explícito', async () => {
        const response = await request(app)
            .post('/api/pagos/cuentas-cobro')
            .set(...conToken(tokenProp))
            .send({
                id_contrato: idContrato,
                valor: 1200,
                inicio: '2023-01-01'
            });

        expect(response.statusCode).toBe(201);

        const cuenta = response.body.cuenta_cobro;

        // El saldo YA NO ES UNA COLUMNA. Viene igual, con el mismo nombre y el
        // mismo valor, pero derivado: sin transacciones todavía, es el importe
        // entero.
        expect(cuenta.saldo_pendiente).toBe(1200);
        expect(cuenta.estado).toBe(ESTADO_CUENTA_PENDIENTE);

        // El periodo sustituye a `mes_correspondiente`: dos fechas, no un
        // instante. El fin es la víspera del siguiente corte.
        expect(cuenta.inicio).toBe('2023-01-01');
        expect(cuenta.fin).toBe('2023-01-31');

        idCuenta = cuenta.id_cuenta_cobro;
    });

    test('Debería registrar un pago que la cubre entera', async () => {
        const response = await request(app)
            .post('/api/pagos')
            .set(...conToken(tokenProp))
            .send({
                id_cuenta_cobro: idCuenta,
                monto: 1200,
                tipo: 'INGRESO',
                medio_pago: 'Efectivo',
                observaciones: 'Pago puntual'
            });

        expect(response.statusCode).toBe(201);
        expect(response.body.cuenta_cobro.estado).toBe(ESTADO_CUENTA_PAGADA);
        expect(parseFloat(response.body.cuenta_cobro.saldo_pendiente)).toBe(0);

        // `tipo` y `medio_pago` son campos distintos y NO se confunden: el medio
        // es "Efectivo", el tipo es INGRESO. Es la trampa del paso 6c.
        expect(response.body.transaccion.tipo).toBe('INGRESO');
        expect(response.body.transaccion.medio_pago).toBe('Efectivo');
    });

    test('El saldo derivado sobrevive a una relectura', async () => {
        // La aserción que antes hacía la columna: lo que devuelve el listado
        // tiene que coincidir con lo que devolvió el registro.
        const response = await request(app).get('/api/pagos').set(...conToken(tokenProp));

        const cuenta = response.body.find((c) => c.id_cuenta_cobro === idCuenta);
        expect(cuenta.saldo_pendiente).toBe(0);
        expect(cuenta.estado).toBe(ESTADO_CUENTA_PAGADA);
    });

    test('Un tipo de transacción que no existe se rechaza', async () => {
        const response = await request(app)
            .post('/api/pagos')
            .set(...conToken(tokenProp))
            .send({ id_cuenta_cobro: idCuenta, monto: 1, tipo: 'REGALO', medio_pago: 'Efectivo' });

        expect(response.statusCode).toBe(400);
    });
});

describe('Dashboard', () => {
    test('Debería retornar resumen con ingresos', async () => {
        const response = await request(app)
            .get('/api/dashboard/resumen')
            .set(...conToken(tokenProp));

        expect(response.statusCode).toBe(200);
        expect(parseFloat(response.body.ingresos_totales)).toBe(1200);
    });
});
