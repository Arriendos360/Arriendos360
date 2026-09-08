/**
 * El gateway como productor: tabla de salida, atomicidad y reintento.
 *
 * Estas pruebas van contra la tabla de salida REAL —PostgreSQL, transacciones
 * de verdad— y entregan por HTTP al doble de ms-inmuebles. Es deliberado: lo
 * que se afirma aquí es exactamente lo que un almacén en memoria no podría
 * demostrar, que es que el evento y el cambio de dominio comparten transacción.
 *
 * La lógica del publicador —espera creciente, orden por clave, apartado— se
 * prueba en `packages/shared/tests/salida.test.ts`, contra un almacén de
 * mentira. Aquí interesa el cableado, no las decisiones.
 */

const request = require('supertest');

const {
    app,
    cerrarEntorno,
    conToken,
    contarEventos,
    crearInmueble,
    crearInquilino,
    entregarEventos,
    inmueblesFalso,
    prepararEntorno,
    registrarPropietario,
    sequelize
} = require('./utiles/entorno');
const { almacen, registrarContratoFormalizado } = require('../src/eventos');
const Contrato = require('../src/models/Contrato');

let tokenProp;
let idProp;
let idInquilino;

beforeAll(async () => {
    await prepararEntorno();

    const propietario = await registrarPropietario({
        email: 'prop@bus.com',
        nombres: 'Prop',
        apellidos: 'Bus',
        documento: 'PB1'
    });
    tokenProp = propietario.token;
    idProp = propietario.id;

    const inquilino = await crearInquilino(tokenProp, {
        email: 'inq@bus.com',
        nombres: 'Inq',
        apellidos: 'Bus',
        documento: 'IB1'
    });
    idInquilino = inquilino.id;
});

afterAll(async () => {
    await cerrarEntorno();
});

/** Las filas de la tabla de salida, crudas. */
const filasDeSalida = async (where = '') => {
    const [filas] = await sequelize.query(
        `SELECT * FROM public.eventos_salida ${where} ORDER BY registrado_en ASC`
    );
    return filas;
};

const firmarContrato = async (direccion) => {
    const { id: idInmueble } = await crearInmueble(tokenProp, { direccion });

    const respuesta = await request(app)
        .post('/api/contratos')
        .set(...conToken(tokenProp))
        .send({
            id_inmueble: idInmueble,
            id_inquilino: idInquilino,
            inicio: '2026-03-01',
            fin: '2027-02-28',
            canon: 1500000
        });

    return { idInmueble, idContrato: respuesta.body.contrato?.id_contrato, respuesta };
};

describe('Firmar un contrato deja el evento en la tabla de salida', () => {
    let idInmueble;
    let idContrato;

    beforeAll(async () => {
        ({ idInmueble, idContrato } = await firmarContrato('Bandeja 1'));
    });

    test('la fila existe, pendiente, antes de que nadie la entregue', async () => {
        const filas = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);

        expect(filas).toHaveLength(1);
        expect(filas[0].tipo).toBe('ContratoFormalizado');
        expect(filas[0].estado).toBe('pendiente');
        expect(filas[0].intentos).toBe(0);
    });

    test('la versión viaja desde el primer evento', async () => {
        // Ponerla después obliga a tratar como versión 1 los sobres que no la
        // traen, y a distinguir un sobre viejo de uno roto. Cuesta un campo.
        const [fila] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);

        expect(fila.version).toBe(1);
    });

    test('el payload sale de las columnas, sin traducción de por medio', async () => {
        // Hasta el paso 6a el emisor traducía: `valor_mensual` salía como `canon`
        // y la fecha de corte se derivaba de `fecha_inicio` porque no había
        // columna. Ahora la tabla tiene los nombres del modelo canónico y el
        // evento lee la fila tal cual. Ver `models/fechasContrato.js` para de
        // dónde sale `fecha_inicio_corte` al crear.
        const [fila] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);

        expect(fila.payload).toEqual({
            id_contrato: idContrato,
            id_inmueble: idInmueble,
            canon: 1500000,
            fecha_inicio_corte: '2026-03-01'
        });
    });

    test('la clave de orden es el inmueble', async () => {
        // Es lo que impide que un `ContratoFinalizado` adelante a su
        // `ContratoFormalizado` y deje el inmueble arrendado para siempre.
        const [fila] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);

        expect(fila.clave_orden).toBe(idInmueble);
    });

    test('al entregarlo, el inmueble converge y la fila queda entregada', async () => {
        await entregarEventos();

        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('arrendado');

        const [fila] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);
        expect(fila.estado).toBe('entregado');
        expect(fila.entregado_en).not.toBeNull();
    });

    test('y no hubo ninguna llamada síncrona de por medio', async () => {
        // La comprobación que da sentido al paso 5. El endpoint
        // `/interno/inmuebles/:id/estado` ya no existe; si algo volviera a
        // llamarlo, esto lo delataría.
        const alEstado = inmueblesFalso().llamadas.filter((l) => /\/estado$/.test(l.ruta));

        expect(alEstado).toHaveLength(0);
    });
});

describe('Atomicidad: el contrato y su evento, o ninguno de los dos', () => {
    test('si la transacción se deshace, no queda evento en la tabla de salida', async () => {
        const { id: idInmueble } = await crearInmueble(tokenProp, { direccion: 'Se deshace' });

        const transaccion = await sequelize.transaction();
        const contrato = await Contrato.create(
            {
                id_inmueble: idInmueble,
                id_inquilino: idInquilino,
                inicio: '2026-01-01',
                fin: '2026-12-31',
                canon: 1000
            },
            { transaction: transaccion, usuarioAuditor: idProp }
        );
        await registrarContratoFormalizado(contrato, transaccion);

        // DENTRO de la transacción, las dos filas existen. Es la mitad que
        // demuestra que el evento se escribió de verdad y no se perdió por otro
        // motivo: sin esto, la aserción de después pasaría aunque
        // `registrarContratoFormalizado` no hiciera nada.
        const [dentro] = await sequelize.query(
            `SELECT * FROM public.eventos_salida WHERE payload->>'id_contrato' = :id`,
            { replacements: { id: contrato.id_contrato }, transaction: transaccion }
        );
        expect(dentro).toHaveLength(1);

        await transaccion.rollback();

        const fuera = await filasDeSalida(
            `WHERE payload->>'id_contrato' = '${contrato.id_contrato}'`
        );
        expect(fuera).toHaveLength(0);
        expect(await Contrato.findByPk(contrato.id_contrato)).toBeNull();
    });

    test('un fallo al guardar el contrato no deja evento suelto', async () => {
        // El mismo caso por el camino de verdad: un valor que PostgreSQL rechaza
        // al insertar. La petición falla y la tabla de salida queda como estaba.
        const { id: idInmueble } = await crearInmueble(tokenProp, { direccion: 'Valor imposible' });
        const antes = await contarEventos();

        const respuesta = await request(app)
            .post('/api/contratos')
            .set(...conToken(tokenProp))
            .send({
                id_inmueble: idInmueble,
                id_inquilino: idInquilino,
                inicio: '2026-01-01',
                fin: '2026-12-31',
                canon: 'no soy un número'
            });

        expect(respuesta.statusCode).toBe(500);
        expect(await contarEventos()).toEqual(antes);
    });
});

describe('Si la entrega falla, el evento sobrevive', () => {
    let idInmueble;
    let idContrato;

    beforeAll(async () => {
        // Se tira SOLO la entrada del bus. La consulta de pertenencia sigue en
        // pie, que es lo que permite firmar el contrato y llegar al punto que
        // interesa: el hecho guardado y el anuncio sin salir.
        inmueblesFalso().caer(503, /\/interno\/eventos$/);
        ({ idInmueble, idContrato } = await firmarContrato('Se cae el bus'));
    });

    afterAll(() => {
        inmueblesFalso().levantar();
    });

    test('el contrato queda creado igual: no depende de que el otro escuche', async () => {
        expect(await Contrato.findByPk(idContrato)).not.toBeNull();
    });

    test('el ciclo cuenta el fallo y la fila sigue pendiente, con su error', async () => {
        const resultado = await entregarEventos();

        expect(resultado.fallidos).toBeGreaterThanOrEqual(1);

        const [fila] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);
        expect(fila.estado).toBe('pendiente');
        expect(fila.intentos).toBe(1);
        expect(fila.ultimo_error).toContain('ms-inmuebles');
    });

    test('cuando el servicio vuelve, el reintento lo entrega y el inmueble converge', async () => {
        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('disponible');

        inmueblesFalso().levantar();
        await entregarEventos();

        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('arrendado');

        const [fila] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);
        expect(fila.estado).toBe('entregado');
    });
});

describe('La entrega va autenticada como servicio', () => {
    test('con una clave que no es la del destinatario, la entrega falla', async () => {
        // Confianza cero también para el bus: `/interno/eventos` exige credencial
        // igual que el resto de `/interno`. Si dejara de mandarse, esta prueba
        // seguiría pasando pero la de arriba no — y al revés, si el doble dejara
        // de exigirla, ésta fallaría. Hacen falta las dos.
        const { idContrato } = await firmarContrato('Clave equivocada');

        const secretoBueno = process.env.SERVICIO_JWT_SECRET;
        process.env.SERVICIO_JWT_SECRET = 'una-clave-que-no-es';

        const resultado = await entregarEventos();
        process.env.SERVICIO_JWT_SECRET = secretoBueno;

        expect(resultado.fallidos).toBeGreaterThanOrEqual(1);

        const [fila] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);
        expect(fila.ultimo_error).toContain('401');

        // Y con la buena, sale.
        await entregarEventos();
        const [despues] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);
        expect(despues.estado).toBe('entregado');
    });
});

describe('Entregar dos veces el mismo evento no lo aplica dos veces', () => {
    test('el consumidor lo descarta por id_evento', async () => {
        const { idInmueble, idContrato } = await firmarContrato('Entregado dos veces');
        await entregarEventos();

        const [fila] = await filasDeSalida(`WHERE payload->>'id_contrato' = '${idContrato}'`);
        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('arrendado');

        // Se ensucia el estado y se reencola: es la forma de provocar la segunda
        // entrega que un corte entre «entregar» y «marcar entregado» produciría
        // en producción.
        inmueblesFalso().inmuebles.get(idInmueble).estado = 'disponible';
        await almacen.reencolar(fila.id_evento);
        await entregarEventos();

        const recibidos = inmueblesFalso().eventos.filter((e) => e.id_evento === fila.id_evento);
        expect(recibidos).toHaveLength(2);

        // Dos entregas, un solo efecto: el manejador no volvió a ejecutarse.
        expect(inmueblesFalso().inmuebles.get(idInmueble).estado).toBe('disponible');
    });
});
