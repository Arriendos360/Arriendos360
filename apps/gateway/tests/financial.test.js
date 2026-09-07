const crypto = require('crypto');

const { Contrato, Pago } = require('../src/models');
const { USUARIO_SISTEMA } = require('../src/models/constantes');
const { procesarContratos, procesarPagos } = require('../src/services/financialEngine');
const { cerrarEntorno, identidadFalsa, inmueblesFalso, prepararEntorno } = require('./utiles/entorno');

/**
 * Motor financiero.
 *
 * Construye los datos con los modelos, porque el motor no tiene endpoint propio
 * desde que se elimino `/api/admin`. Ni los usuarios ni los inmuebles se crean
 * aqui: viven en ms-identidad y ms-inmuebles, y para estas pruebas los ponen sus
 * dobles. Al gateway le llegan sus UUID en `id_inquilino` e `id_inmueble`, que
 * es todo lo que guarda de ellos.
 */

/** Pone un inmueble en el doble, sin pasar por la API. */
const inmuebleEnElDoble = (idPropietario, direccion) => {
    const inmueble = {
        id_inmueble: crypto.randomUUID(),
        direccion,
        tipo: 'casa',
        estado: 'arrendado',
        id_propietario: idPropietario
    };

    inmueblesFalso().inmuebles.set(inmueble.id_inmueble, inmueble);
    return inmueble;
};

let idContrato;
let idPropietario;
let idInquilino;

beforeAll(async () => {
    const identidad = await prepararEntorno();

    // Los usuarios se ponen directamente en el doble: para lo que aqui interesa
    // —que el motor sepa a quien avisar— no hace falta pasar por la API.
    idPropietario = crypto.randomUUID();
    idInquilino = crypto.randomUUID();

    identidad.usuarios.set(idPropietario, {
        id: idPropietario,
        nombres: 'P',
        apellidos: 'F',
        email: 'prop_finance@test.com',
        telefono: '3001',
        documento: 'PROP1',
        roles: ['PROPIETARIO']
    });
    identidad.usuarios.set(idInquilino, {
        id: idInquilino,
        nombres: 'I',
        apellidos: 'F',
        email: 'inq_finance@test.com',
        telefono: '3002',
        documento: 'FIN1',
        roles: ['INQUILINO']
    });
});

afterAll(async () => {
    await cerrarEntorno();
});

describe('Motor Financiero (Automatizacion)', () => {
    jest.setTimeout(15000);

    test('RF-11: Deberia generar un recibo si faltan 2 dias para el aniversario', async () => {
        const inm = inmuebleEnElDoble(idPropietario, 'Finance Street');

        const pasadoManana = new Date();
        pasadoManana.setDate(pasadoManana.getDate() + 2);

        const contrato = await Contrato.create(
            {
                id_inmueble: inm.id_inmueble,
                id_inquilino: idInquilino,
                fecha_inicio: pasadoManana,
                fecha_fin: new Date(2025, 1, 1),
                valor_mensual: 1000,
                estado: 1
            },
            { usuarioAuditor: idPropietario }
        );
        idContrato = contrato.id_contrato;

        await procesarContratos();

        const pago = await Pago.findOne({ where: { id_contrato: idContrato } });
        expect(pago).not.toBeNull();
        expect(pago.estado).toBe(1);
        expect(parseFloat(pago.monto_total)).toBe(1000);

        // El motor corre sin usuario autenticado: la auditoria queda a nombre
        // del usuario de sistema.
        expect(pago.creado_por).toBe(USUARIO_SISTEMA);
    });

    test('Deberia cambiar a MORA despues de 6 dias del corte', async () => {
        const hoy = new Date();
        const haceSieteDias = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);

        const pagoAntiguo = await Pago.create({
            id_contrato: idContrato,
            monto_total: 1000,
            saldo_pendiente: 1000,
            mes_correspondiente: haceSieteDias,
            estado: 1
        });

        await procesarPagos();

        const pagoActualizado = await Pago.findByPk(pagoAntiguo.id_pago);
        expect(pagoActualizado.estado).toBe(3);
    });

    test('compone las partes en un solo viaje, no una vez por contrato', async () => {
        // Es la garantia contra el N+1 por red: el motor recorre todos los
        // contratos activos, pero pregunta a ms-identidad una vez por barrido.
        const identidad = identidadFalsa();
        identidad.limpiarLlamadas();

        await procesarContratos();

        const consultas = identidad.llamadas.filter((l) => l.ruta.startsWith('/interno/usuarios'));
        expect(consultas).toHaveLength(1);
    });

    test('si ms-identidad no responde, el motor sigue haciendo su trabajo', async () => {
        // Generar cuentas de cobro y marcar mora es lo principal; avisar por
        // correo es lo accesorio. Un fallo de identidad no puede parar lo uno
        // por lo otro.
        const url = process.env.MS_IDENTIDAD_URL;
        process.env.MS_IDENTIDAD_URL = 'http://127.0.0.1:1';

        await expect(procesarPagos()).resolves.not.toThrow();

        process.env.MS_IDENTIDAD_URL = url;
    });
});
