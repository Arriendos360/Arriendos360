/**
 * Contratos, ya con el modelo canónico.
 *
 * Lo que se comprueba aquí es lo que el paso 6a cambió en lo observable: los
 * nombres del payload, el estado como catálogo, las dos fechas que se derivan y
 * se GUARDAN, y que el deudor solidario se pueda omitir.
 *
 * La regla del día 31 no se prueba aquí sino en `fechasContrato.test.js`: es
 * lógica pura y a través de la API sólo se podría ejercitar un caso por
 * contrato. Aquí se comprueba que esa regla está enchufada.
 */

const request = require('supertest');

const {
    app,
    cerrarEntorno,
    conToken,
    crearInmueble,
    crearInquilino,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');
const Contrato = require('../src/models/Contrato');
const { ESTADO_CONTRATO_ACTIVO } = require('../src/models/constantes');

let tokenProp;
let idInquilino;

beforeAll(async () => {
    await prepararEntorno();

    const propietario = await registrarPropietario({
        email: 'prop@contratos.com',
        nombres: 'Prop',
        apellidos: 'Contrato',
        documento: 'PC1'
    });
    tokenProp = propietario.token;

    const inquilino = await crearInquilino(tokenProp, {
        email: 'inq@contratos.com',
        nombres: 'Inq',
        apellidos: 'Contrato',
        documento: 'IC1'
    });
    idInquilino = inquilino.id;
});

afterAll(async () => {
    await cerrarEntorno();
});

/** Firma un contrato sobre un inmueble nuevo. `extra` sobrescribe el cuerpo. */
const firmar = async (direccion, extra = {}) => {
    const { id: idInmueble } = await crearInmueble(tokenProp, { direccion });

    const respuesta = await request(app)
        .post('/api/contratos')
        .set(...conToken(tokenProp))
        .send({
            id_inmueble: idInmueble,
            id_inquilino: idInquilino,
            inicio: '2026-03-31',
            fin: '2027-03-30',
            canon: 1500000,
            ...extra
        });

    return { idInmueble, respuesta, contrato: respuesta.body.contrato };
};

/** Lee la fila, no la respuesta: lo que importa es lo que quedó guardado. */
const guardado = (id) => Contrato.findByPk(id);

describe('El payload usa los nombres del modelo canónico', () => {
    test('crear con inicio, fin y canon devuelve 201', async () => {
        const { respuesta, contrato } = await firmar('Canónica 1');

        expect(respuesta.statusCode).toBe(201);
        expect(contrato.inicio).toBeDefined();
        expect(contrato.fin).toBeDefined();
        expect(parseFloat(contrato.canon)).toBe(1500000);
    });

    test('un canon negativo sigue siendo 400, con el nombre nuevo en el mensaje', async () => {
        const { respuesta } = await firmar('Canónica 2', { canon: -1 });

        expect(respuesta.statusCode).toBe(400);
        expect(respuesta.body.mensaje).toContain('canon');
    });

    test('el contrato nace `activo`, no 1', async () => {
        const { contrato } = await firmar('Canónica 3');

        expect(contrato.estado).toBe(ESTADO_CONTRATO_ACTIVO);
        expect(contrato.estado).toBe('activo');
    });

    test('las columnas muertas ya no existen en la respuesta', async () => {
        // `deposito` e `inventario_fotografico` no están en el modelo canónico,
        // ningún camino de código las escribía y las 16 filas de la base de
        // desarrollo las tenían vacías.
        const { contrato } = await firmar('Canónica 4');

        expect(contrato).not.toHaveProperty('deposito');
        expect(contrato).not.toHaveProperty('inventario_fotografico');
    });
});

describe('Las dos fechas del ciclo se derivan y SE GUARDAN', () => {
    test('sin mandarlas, salen del inicio', async () => {
        const { contrato } = await firmar('Derivada 1');

        expect(contrato.fecha_inicio_corte).toBe('2026-03-31');
        expect(contrato.fecha_limite_pago).toBe(31);
    });

    test('quedan en la fila, no se calculan al leer', async () => {
        // La diferencia importa: una columna se puede renegociar, un cálculo no.
        const { contrato } = await firmar('Derivada 2');
        const fila = await guardado(contrato.id_contrato);

        expect(fila.fecha_inicio_corte).toBe('2026-03-31');
        expect(fila.fecha_limite_pago).toBe(31);
    });

    test('el día 31 se guarda 31, sin recortar', async () => {
        // El recorte se aplica al RESOLVER el día contra un mes concreto, no al
        // guardarlo. Guardar 28 haría que el contrato cobrara el 28 también en
        // abril, que sí tiene 31: un febrero se llevaría por delante el resto de
        // la vida del contrato.
        const fila = await guardado((await firmar('Derivada 3')).contrato.id_contrato);

        expect(fila.fecha_limite_pago).toBe(31);
    });

    test('el día se deriva en UTC: el 31 no se convierte en 30', async () => {
        // `inicio` se guarda como medianoche UTC. Derivar el día en hora local
        // daría 30 en Bogotá, que es un día que el propietario nunca escribió.
        const { contrato } = await firmar('Derivada 4', { inicio: '2026-01-31', fin: '2027-01-30' });

        expect(contrato.fecha_limite_pago).toBe(31);
        expect(contrato.fecha_inicio_corte).toBe('2026-01-31');
    });

    test('un día límite explícito gana sobre la derivación', async () => {
        // Es lo que permite pactar un ciclo distinto del día de la firma, y lo
        // que hace que la sugerencia del formulario sea una sugerencia.
        const { contrato } = await firmar('Derivada 5', { fecha_limite_pago: 5 });

        expect(contrato.fecha_limite_pago).toBe(5);
        // La fecha de corte sigue derivándose: son campos independientes.
        expect(contrato.fecha_inicio_corte).toBe('2026-03-31');
    });

    test('llega como cadena desde el formulario y se guarda como entero', async () => {
        // `multipart/form-data` no tiene tipos: todo llega como texto.
        const { contrato } = await firmar('Derivada 6', { fecha_limite_pago: '15' });

        expect(contrato.fecha_limite_pago).toBe(15);
    });

    test.each([0, 32, 2.5, 'quince'])('un día límite de %p es 400, no 500', async (dia) => {
        // Un dato del cliente que no vale es un 400. Sin la comprobación del
        // controlador, la validación del modelo saldría por el `catch` general
        // como un 500 con el error de Sequelize dentro.
        const { respuesta } = await firmar(`Derivada mala ${dia}`, { fecha_limite_pago: dia });

        expect(respuesta.statusCode).toBe(400);
        expect(respuesta.body.mensaje).toContain('día del mes');
    });
});

describe('El deudor solidario es opcional', () => {
    test('un contrato sin codeudor se crea sin problema', async () => {
        // No todo arriendo tiene codeudor. Exigirlo impediría registrar los que
        // no lo tienen, que en arriendos pequeños son mayoría.
        const { respuesta, contrato } = await firmar('Sin codeudor');

        expect(respuesta.statusCode).toBe(201);
        expect(contrato.nombre_deudor_solidario).toBeNull();
        expect(contrato.documento_deudor_solidario).toBeNull();
    });

    test('y con codeudor, se guardan los dos', async () => {
        const { contrato } = await firmar('Con codeudor', {
            nombre_deudor_solidario: 'Ana Fiadora',
            documento_deudor_solidario: '10203040'
        });

        const fila = await guardado(contrato.id_contrato);
        expect(fila.nombre_deudor_solidario).toBe('Ana Fiadora');
        expect(fila.documento_deudor_solidario).toBe('10203040');
    });

    test('`info_contrato` también es opcional y se guarda si viene', async () => {
        const { contrato } = await firmar('Con info', {
            info_contrato: 'Incluye parqueadero cubierto.'
        });

        expect((await guardado(contrato.id_contrato)).info_contrato).toBe(
            'Incluye parqueadero cubierto.'
        );
    });
});

describe('Finalizar mueve el estado al valor del catálogo', () => {
    test('pasa a `finalizado`', async () => {
        const { contrato } = await firmar('Para finalizar');

        const respuesta = await request(app)
            .put(`/api/contratos/${contrato.id_contrato}/finalizar`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(200);
        expect(respuesta.body.contrato.estado).toBe('finalizado');
        expect((await guardado(contrato.id_contrato)).estado).toBe('finalizado');
    });
});
