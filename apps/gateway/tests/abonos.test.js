const request = require('supertest');

const {
    ESTADO_CUENTA_PAGADA,
    ESTADO_CUENTA_PARCIAL,
    ESTADO_CUENTA_PENDIENTE,
    ESTADO_TRANSACCION_ANULADA
} = require('../src/models/constantes');
const {
    app,
    cerrarEntorno,
    conToken,
    crearInquilino,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');

/**
 * Transacciones: registro, saldo derivado y anulación. RF-17 y RF-18.
 *
 * ── QUÉ COMPRUEBA ESTA SUITE DESPUÉS DEL PASO 6c ─────────────────────────────
 *
 * Las cuatro afirmaciones de siempre —un abono parcial deja la cuenta en
 * parcial, un sobrepago se rechaza, llegar a cero la salda, y el comprobante
 * sale en PDF— siguen aquí. Lo que se añade es lo que el saldo derivado y la
 * anulación hacen posible comprobar, y que antes no existía:
 *
 *   1. El saldo derivado COINCIDE con el que daba la columna denormalizada, en
 *      los mismos escenarios. Es la prueba de que quitar la columna no cambió
 *      ningún número.
 *   2. Anular devuelve el saldo Y el estado a lo que eran antes de registrar la
 *      transacción, sin que nadie los haya guardado en ninguna parte.
 *   3. Un comprobante emitido ANTES conserva su `saldo_restante_momento`. Es la
 *      única cifra de saldo que no se deriva, porque es una foto de un documento
 *      que ya está impreso.
 */

let tokenProp, idContrato, idCuenta;

/** Lo que la API dice hoy que se debe de esta cuenta. */
const saldoDeLaCuenta = async () => {
    const respuesta = await request(app).get('/api/pagos').set(...conToken(tokenProp));
    return respuesta.body.find((c) => c.id_cuenta_cobro === idCuenta);
};

/** Registra una transacción contra la cuenta de la suite. */
const registrar = (cuerpo) =>
    request(app)
        .post('/api/pagos')
        .set(...conToken(tokenProp))
        .send({ id_cuenta_cobro: idCuenta, tipo: 'INGRESO', ...cuerpo });

beforeAll(async () => {
    await prepararEntorno();

    // 1. Registrar Propietario
    const propietario = await registrarPropietario({
        email: 'prop@abono.com', documento: 'P_ABONO', nombres: 'Prop', apellidos: 'Abono'
    });
    tokenProp = propietario.token;

    // 2. Dar de alta al Inquilino. `id_inquilino` es su UUID, no su cédula.
    const inquilino = await crearInquilino(tokenProp, {
        email: 'inq@abono.com', documento: 'I_ABONO', nombres: 'Inq', apellidos: 'Abono'
    });

    // 3. Crear Inmueble y Contrato
    const resInm = await request(app).post('/api/inmuebles').set(...conToken(tokenProp)).send({ direccion: 'Abono Street', tipo: 'casa' });
    const resCon = await request(app).post('/api/contratos').set(...conToken(tokenProp)).send({
        id_inmueble: resInm.body.inmueble.id_inmueble, id_inquilino: inquilino.id, inicio: '2023-01-01', fin: '2023-12-31', canon: 1000
    });
    idContrato = resCon.body.contrato.id_contrato;

    // 4. Emitir la cuenta de cobro inicial
    const resCuenta = await request(app).post('/api/pagos/cuentas-cobro').set(...conToken(tokenProp)).send({
        id_contrato: idContrato, valor: 1000, inicio: '2023-01-01'
    });
    idCuenta = resCuenta.body.cuenta_cobro.id_cuenta_cobro;
});

afterAll(async () => { await cerrarEntorno(); });

describe('RF-17 & RF-18: Registro de transacciones', () => {
    test('Debería registrar un pago parcial y dejar la cuenta en PARCIAL', async () => {
        const response = await registrar({ monto: 400, medio_pago: 'Transferencia', observaciones: 'Primer abono' });

        expect(response.statusCode).toBe(201);
        expect(parseFloat(response.body.cuenta_cobro.saldo_pendiente)).toBe(600);
        expect(response.body.cuenta_cobro.estado).toBe(ESTADO_CUENTA_PARCIAL);
        expect(parseFloat(response.body.transaccion.monto)).toBe(400);
    });

    test('El saldo derivado coincide con el que daba la columna: 1000 - 400 = 600', async () => {
        // Es el mismo número que devolvía `saldo_pendiente` cuando era columna.
        // La diferencia es que ahora sale de sumar las transacciones, así que
        // esta aserción es la que garantiza que quitarla no movió nada.
        const cuenta = await saldoDeLaCuenta();
        expect(cuenta.saldo_pendiente).toBe(600);
        expect(cuenta.estado).toBe(ESTADO_CUENTA_PARCIAL);
    });

    test('Debería bloquear un sobrepago (monto > saldo pendiente)', async () => {
        const response = await registrar({ monto: 700 }); // Saldo es 600

        expect(response.statusCode).toBe(400);
        expect(response.body.mensaje).toContain('Monto inválido o superior al saldo');
    });

    test('Debería completar el pago al llegar a saldo cero', async () => {
        const response = await registrar({ monto: 600, medio_pago: 'Efectivo' });

        expect(response.statusCode).toBe(201);
        expect(parseFloat(response.body.cuenta_cobro.saldo_pendiente)).toBe(0);
        expect(response.body.cuenta_cobro.estado).toBe(ESTADO_CUENTA_PAGADA);
    });

    test('Debería poder ver el historial de transacciones', async () => {
        const response = await request(app)
            .get(`/api/pagos/${idCuenta}/transacciones`)
            .set(...conToken(tokenProp));

        expect(response.statusCode).toBe(200);
        expect(response.body.length).toBe(2);
    });

    test('RF-18: Debería obtener el comprobante de una transacción', async () => {
        const resTrx = await request(app).get(`/api/pagos/${idCuenta}/transacciones`).set(...conToken(tokenProp));
        const idTransaccion = resTrx.body[0].id_transaccion;

        const response = await request(app)
            .get(`/api/pagos/transacciones/${idTransaccion}/comprobante`)
            .set(...conToken(tokenProp));

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toBe('application/pdf');
        expect(response.body instanceof Buffer).toBe(true);
    });
});

describe('Anulación de transacciones', () => {
    /**
     * Anular es la única operación que deshace un movimiento contable, y esta
     * suite comprueba que lo deshace SIN guardar nada: el saldo y el estado
     * salen otra vez de la misma cuenta de siempre, que ahora ignora la fila
     * anulada.
     */
    test('devuelve el saldo y el estado a lo que eran antes de registrarla', async () => {
        // Punto de partida: la cuenta está PAGADA, saldo 0, con 400 + 600.
        const antesDeAnular = await saldoDeLaCuenta();
        expect(antesDeAnular.saldo_pendiente).toBe(0);
        expect(antesDeAnular.estado).toBe(ESTADO_CUENTA_PAGADA);

        const resTrx = await request(app).get(`/api/pagos/${idCuenta}/transacciones`).set(...conToken(tokenProp));
        const deSeiscientos = resTrx.body.find((t) => parseFloat(t.monto) === 600);

        const anulacion = await request(app)
            .post(`/api/pagos/transacciones/${deSeiscientos.id_transaccion}/anular`)
            .set(...conToken(tokenProp));

        expect(anulacion.statusCode).toBe(200);

        // Exactamente el estado y el saldo que había justo antes de los 600.
        const despues = await saldoDeLaCuenta();
        expect(despues.saldo_pendiente).toBe(600);
        expect(despues.estado).toBe(ESTADO_CUENTA_PARCIAL);
    });

    test('la transacción anulada no se borra: sigue en el historial, marcada', async () => {
        // Esconderla sería esconder que el movimiento se registró y se
        // corrigió, que es justo lo que el estado existe para hacer visible.
        const resTrx = await request(app).get(`/api/pagos/${idCuenta}/transacciones`).set(...conToken(tokenProp));

        expect(resTrx.body.length).toBe(2);
        const anulada = resTrx.body.find((t) => parseFloat(t.monto) === 600);
        expect(anulada.estado).toBe(ESTADO_TRANSACCION_ANULADA);
    });

    test('un comprobante emitido antes conserva su saldo_restante_momento', async () => {
        // La transacción de 400 se registró cuando quedaban 600 por pagar, y su
        // comprobante lo dice. Después llegaron 600 y se anularon: el saldo
        // vigente ha ido de 600 a 0 y otra vez a 600, pero la FOTO de aquel
        // comprobante no se ha movido, porque no se deriva.
        const resTrx = await request(app).get(`/api/pagos/${idCuenta}/transacciones`).set(...conToken(tokenProp));
        const deCuatrocientos = resTrx.body.find((t) => parseFloat(t.monto) === 400);

        expect(parseFloat(deCuatrocientos.saldo_restante_momento)).toBe(600);

        // Y el de la anulada conserva el suyo, que era 0: el documento que
        // alguien recibió decía «saldado» y sigue diciéndolo.
        const anulada = resTrx.body.find((t) => parseFloat(t.monto) === 600);
        expect(parseFloat(anulada.saldo_restante_momento)).toBe(0);

        const comprobante = await request(app)
            .get(`/api/pagos/transacciones/${anulada.id_transaccion}/comprobante`)
            .set(...conToken(tokenProp));
        expect(comprobante.statusCode).toBe(200);
    });

    test('anular dos veces la misma transacción responde 409, no 403', async () => {
        // El recurso es suyo y su rol es el correcto: las dos capas de
        // autorización ya dijeron que sí. Lo que falla es el estado del
        // recurso. Ver la nota de CLAUDE.md sobre guardias y códigos.
        const resTrx = await request(app).get(`/api/pagos/${idCuenta}/transacciones`).set(...conToken(tokenProp));
        const anulada = resTrx.body.find((t) => t.estado === ESTADO_TRANSACCION_ANULADA);

        const respuesta = await request(app)
            .post(`/api/pagos/transacciones/${anulada.id_transaccion}/anular`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(409);
    });

    test('anular la última transacción devuelve la cuenta a PENDIENTE', async () => {
        // El estado se recalcula a partir del saldo, no se recuerda: con todo
        // anulado, el saldo vuelve a ser el importe entero y la cuenta vuelve a
        // estar como recién emitida.
        const resTrx = await request(app).get(`/api/pagos/${idCuenta}/transacciones`).set(...conToken(tokenProp));
        const deCuatrocientos = resTrx.body.find((t) => parseFloat(t.monto) === 400);

        await request(app)
            .post(`/api/pagos/transacciones/${deCuatrocientos.id_transaccion}/anular`)
            .set(...conToken(tokenProp));

        const cuenta = await saldoDeLaCuenta();
        expect(cuenta.saldo_pendiente).toBe(1000);
        expect(cuenta.estado).toBe(ESTADO_CUENTA_PENDIENTE);
        // Y sin fecha de pago: no está pagada.
        expect(cuenta.fecha_pago).toBeNull();
    });
});
