/**
 * El dashboard: lo ÚNICO que el gateway sirve por su cuenta desde el paso 6e.
 *
 * ── POR QUÉ ESTA SUITE APARECE AHORA ────────────────────────────────────────
 *
 * Hasta el 6e el dashboard tenía media pierna en la base del gateway:
 * `CuentaCobro.findAll` y `CuentaCobro.count` contra sus propias tablas. Con
 * ellas dentro, «probar el dashboard» era casi probar Sequelize, y lo poco que
 * quedaba lo cubría de refilón `full_coverage.test.js` comprobando que las
 * cuatro rutas devolvían 200.
 *
 * Ahora el dashboard NO CONSULTA NINGUNA BASE: es puro agregado de tres
 * servicios. Eso lo convierte en el sitio del gateway con más lógica propia y
 * con más formas de fallar en silencio, así que se prueba en serio.
 *
 * ── LAS DOS COSAS QUE DEFIENDE ──────────────────────────────────────────────
 *
 * 1. **Que las cifras salgan bien** al componerlas de tres sitios. Una suma mal
 *    hecha aquí no revienta: pinta un número equivocado, que es peor.
 *
 * 2. **Que un fallo NO se degrade a ceros.** Es el requisito explícito del paso
 *    6e y la razón por la que `clientes/financiero.js` no degrada nunca. Un
 *    dashboard que dice «$0 de ingresos, 0 en mora» cuando en realidad no pudo
 *    preguntar es peor que un error: PARECE una respuesta, y el propietario se
 *    la cree. Se comprueba tumbando los tres servicios, uno por uno.
 */

const request = require('supertest');

const {
    app,
    cerrarEntorno,
    conToken,
    contratosFalso,
    crearInmueble,
    crearInquilino,
    financieroFalso,
    inmueblesFalso,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');

let propietario;
let idContrato;

/** Ayuda: pide una métrica con el token del propietario de la suite. */
const metrica = (ruta, token = propietario.token) =>
    request(app)
        .get(`/api/dashboard/${ruta}`)
        .set(...conToken(token));

beforeAll(async () => {
    await prepararEntorno();

    propietario = await registrarPropietario({
        email: 'prop@dashboard.com',
        documento: 'P_DASH',
        nombres: 'Prop',
        apellidos: 'Dash'
    });

    const inquilino = await crearInquilino(propietario.token, {
        email: 'inq@dashboard.com',
        documento: 'I_DASH',
        nombres: 'Inq',
        apellidos: 'Dash'
    });

    const { id: idInmueble } = await crearInmueble(propietario.token, {
        direccion: 'Calle del Tablero 1'
    });

    const contrato = await request(app)
        .post('/api/contratos')
        .set(...conToken(propietario.token))
        .send({
            id_inmueble: idInmueble,
            id_inquilino: inquilino.id,
            inicio: '2026-01-01',
            fin: '2026-12-31',
            canon: 1000
        });
    idContrato = contrato.body.contrato.id_contrato;

    // Un segundo inmueble sin contrato, para que «disponibles» no sea cero.
    await crearInmueble(propietario.token, { direccion: 'Calle del Tablero 2' });

    // Las cuentas de cobro se siembran en el doble de Financiero: son suyas, no
    // del gateway. Tres estados distintos, para que cada métrica tenga algo que
    // separar.
    financieroFalso().sembrarCuenta({
        id_contrato: idContrato,
        valor: 1000,
        estado: 'PAGADA',
        inicio: '2026-01-01'
    });
    financieroFalso().sembrarCuenta({
        id_contrato: idContrato,
        valor: 500,
        estado: 'PAGADA',
        inicio: '2026-02-01'
    });
    financieroFalso().sembrarCuenta({
        id_contrato: idContrato,
        valor: 700,
        estado: 'PENDIENTE',
        // Un corte ya pasado: entra en la métrica de mora aunque el estado no
        // sea EN_MORA todavía. Es la condición asimétrica que el `Op.or` hacía.
        inicio: '2020-01-01'
    });
    financieroFalso().sembrarCuenta({
        id_contrato: idContrato,
        valor: 300,
        estado: 'EN_MORA',
        inicio: '2026-03-01'
    });
});

afterAll(async () => {
    await cerrarEntorno();
});

describe('Las métricas se componen de tres servicios', () => {
    test('ingresos suma sólo las cuentas PAGADA', async () => {
        const respuesta = await metrica('ingresos');

        expect(respuesta.statusCode).toBe(200);
        expect(parseFloat(respuesta.body.total_ingresos)).toBe(1500);
        expect(respuesta.body.cantidad_pagos).toBe(2);
    });

    test('mora cuenta las EN_MORA y las PENDIENTE con el corte pasado', async () => {
        const respuesta = await metrica('mora');

        expect(respuesta.statusCode).toBe(200);
        // La de 700 (pendiente y vencida) y la de 300 (en mora). La de
        // 2026-02-01 está pagada y la otra pendiente no ha llegado a su corte.
        expect(respuesta.body.cantidad_en_mora).toBe(2);
        expect(respuesta.body.total_mora).toBe(1000);
    });

    test('el detalle de mora trae `saldo_pendiente`, que el gateway no calcula', async () => {
        // Es lo único de esa respuesta que sale derivado del otro lado: el
        // gateway no tiene las transacciones, así que no podría restarlo.
        const respuesta = await metrica('mora');

        for (const cuenta of respuesta.body.detalle) {
            expect(cuenta.saldo_pendiente).toBeDefined();
        }
    });

    test('contratos-activos trae el inmueble compuesto', async () => {
        const respuesta = await metrica('contratos-activos');

        expect(respuesta.statusCode).toBe(200);
        expect(respuesta.body.cantidad_activos).toBe(1);
        expect(respuesta.body.contratos[0].Inmueble.direccion).toBe('Calle del Tablero 1');
    });

    test('resumen cruza los tres servicios en una sola respuesta', async () => {
        const respuesta = await metrica('resumen');

        expect(respuesta.statusCode).toBe(200);

        // De ms-financiero. Dos PAGADA suman 1500; PENDIENTE hay una sola —la
        // otra vencida esta en EN_MORA, que es otro estado y no se cuenta aqui.
        expect(parseFloat(respuesta.body.ingresos_totales)).toBe(1500);
        expect(respuesta.body.pagos_pendientes).toBe(1);

        // De ms-contratos.
        expect(respuesta.body.contratos.activos).toBe(1);
        expect(respuesta.body.contratos.finalizados).toBe(0);

        // De ms-inmuebles. El primero quedó `arrendado` al firmar; el segundo
        // sigue disponible.
        expect(respuesta.body.inmuebles.disponibles + respuesta.body.inmuebles.arrendados).toBe(2);
    });

    test('un propietario sin contratos ve ceros de verdad, y eso SÍ es correcto', async () => {
        // La otra cara del requisito. «Cero» miente cuando no se pudo preguntar;
        // cuando sí se preguntó y no hay nada, cero es la respuesta buena. Sin
        // esta prueba, «propagar siempre» podría implementarse rompiendo también
        // este caso.
        const nuevo = await registrarPropietario({
            email: 'vacio@dashboard.com',
            documento: 'P_VACIO',
            nombres: 'Sin',
            apellidos: 'Nada'
        });

        const respuesta = await metrica('resumen', nuevo.token);

        expect(respuesta.statusCode).toBe(200);
        expect(parseFloat(respuesta.body.ingresos_totales)).toBe(0);
        expect(respuesta.body.contratos.activos).toBe(0);
    });
});

describe('Un fallo devuelve 502, NO cifras en cero', () => {
    /** Las cuatro rutas, que es lo que hace la afirmación completa. */
    const RUTAS = ['ingresos', 'mora', 'contratos-activos', 'resumen'];

    test('si ms-financiero no responde', async () => {
        financieroFalso().caer(503);

        for (const ruta of RUTAS) {
            const respuesta = await metrica(ruta);

            // `contratos-activos` no consulta Financiero, así que sigue
            // respondiendo 200: es correcto, no toca esas cifras.
            if (ruta === 'contratos-activos') {
                expect(respuesta.statusCode).toBe(200);
                continue;
            }

            expect(respuesta.statusCode).toBe(502);
            expect(respuesta.body.mensaje).toContain('financiero');
            // Y lo que NO trae: nada que parezca una cifra.
            expect(respuesta.body.total_ingresos).toBeUndefined();
            expect(respuesta.body.ingresos_totales).toBeUndefined();
            expect(respuesta.body.total_mora).toBeUndefined();
        }

        financieroFalso().levantar();
    });

    test('si ms-contratos no responde', async () => {
        contratosFalso().caer(503);

        for (const ruta of RUTAS) {
            const respuesta = await metrica(ruta);

            expect(respuesta.statusCode).toBe(502);
            expect(respuesta.body.mensaje).toContain('contratos');
        }

        contratosFalso().levantar();
    });

    test('si ms-inmuebles no responde, el resumen también', async () => {
        // El resumen es el único que le pregunta directamente; los otros tres
        // llegan a los inmuebles a través de contratos.
        inmueblesFalso().caer(503);

        const respuesta = await metrica('resumen');

        expect(respuesta.statusCode).toBe(502);
        expect(respuesta.body.inmuebles).toBeUndefined();

        inmueblesFalso().levantar();
    });

    test('y con MS_FINANCIERO_URL sin definir tampoco se inventa un cero', async () => {
        // Que falte la variable es un error de despliegue, no «no hay cuentas de
        // cobro». Devolver una lista vacía aquí sería la misma mentira con otra
        // causa, y además la más difícil de detectar: no hay ningún servicio
        // caído que mirar.
        const url = process.env.MS_FINANCIERO_URL;
        process.env.MS_FINANCIERO_URL = '';

        const respuesta = await metrica('ingresos');

        expect(respuesta.statusCode).toBe(502);

        process.env.MS_FINANCIERO_URL = url;
    });

    test('cuando todos vuelven, las cifras vuelven con ellos', async () => {
        // Cierra el ciclo: las pruebas anteriores tumban servicios y hay que
        // dejar constancia de que el estado se restauró, o un fallo de esta
        // suite contaminaría las siguientes sin decir por qué.
        const respuesta = await metrica('resumen');

        expect(respuesta.statusCode).toBe(200);
        expect(parseFloat(respuesta.body.ingresos_totales)).toBe(1500);
    });
});

describe('El dashboard sigue siendo sólo del propietario', () => {
    test('un inquilino no entra, aunque sea parte de un contrato', async () => {
        // Lo deniega la matriz RBAC, antes de llegar al controlador. Se
        // comprueba aquí porque es lo que hace que estas métricas puedan asumir
        // que el `sub` del token es el del dueño.
        const login = await request(app)
            .post('/api/auth/login')
            .send({ email: 'inq@dashboard.com', contrasena: 'pass123' });

        const respuesta = await metrica('resumen', login.body.token);

        expect(respuesta.statusCode).toBe(403);
    });

    test('sin token tampoco', async () => {
        const respuesta = await request(app).get('/api/dashboard/resumen');
        expect(respuesta.statusCode).toBe(401);
    });
});
