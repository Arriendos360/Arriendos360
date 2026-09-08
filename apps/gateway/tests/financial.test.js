const crypto = require('crypto');

const { Contrato, CuentaCobro } = require('../src/models');
const {
    ESTADO_CONTRATO_ACTIVO,
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PENDIENTE,
    USUARIO_SISTEMA
} = require('../src/models/constantes');
const { hoyEnZonaNegocio } = require('../src/models/fechasContrato');
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
 *
 * ── QUE CAMBIA EN EL PASO 6c, Y QUE NO ───────────────────────────────────────
 *
 * A diferencia del 6a, esta suite SI cambia, porque cambia el modelo sobre el
 * que corre: `Pago` es `CuentaCobro`, `monto_total` es `valor`, el estado es un
 * catalogo y `mes_correspondiente` se parte en `inicio` y `fin`. Lo que NO
 * cambia es ninguna de las tres afirmaciones de comportamiento, que son la razon
 * de ser de la suite y siguen aqui palabra por palabra:
 *
 *   - el recibo se genera dos dias antes del aniversario,
 *   - la mora entra al sexto dia del corte,
 *   - el barrido compone las partes en un solo viaje.
 *
 * ── Y AHORA LAS FECHAS SON DETERMINISTAS ─────────────────────────────────────
 *
 * La version anterior construia las fechas con aritmetica LOCAL y avisaba en un
 * comentario de que eso ataba el resultado a la hora y a la zona de la maquina.
 * El paso 6c lo cierra: el motor pregunta que dia es en `America/Bogota`, que es
 * la zona del negocio, y esta suite parte de ESE MISMO dia. La consecuencia es
 * que la prueba dice lo mismo a las 02:00 que a las 23:00, y en un contenedor
 * en UTC que en un portatil en Bogota.
 */

/** Suma dias a un `YYYY-MM-DD` sin salir del calendario. */
const sumarDias = (fechaISO, dias) =>
    new Date(Date.parse(`${fechaISO}T00:00:00Z`) + dias * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

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

        const hoy = hoyEnZonaNegocio();
        const pasadoManana = sumarDias(hoy, 2);

        const contrato = await Contrato.create(
            {
                id_inmueble: inm.id_inmueble,
                id_inquilino: idInquilino,
                inicio: pasadoManana,
                fin: '2027-01-01',
                canon: 1000,
                // La fecha de corte se pone EXPLICITA en vez de dejar que la
                // derive el hook, igual que antes: escribirla aqui es lo que
                // hace que el motor reciba exactamente el dia de corte que la
                // prueba quiere ejercitar, sin depender de como interprete el
                // hook un `inicio` con hora.
                fecha_inicio_corte: pasadoManana,
                fecha_limite_pago: Number(pasadoManana.slice(8, 10)),
                estado: ESTADO_CONTRATO_ACTIVO
            },
            { usuarioAuditor: idPropietario }
        );
        idContrato = contrato.id_contrato;

        await procesarContratos();

        const cuenta = await CuentaCobro.findOne({ where: { id_contrato: idContrato } });
        expect(cuenta).not.toBeNull();
        expect(cuenta.estado).toBe(ESTADO_CUENTA_PENDIENTE);
        expect(parseFloat(cuenta.valor)).toBe(1000);

        // El periodo es EXPLICITO desde el paso 6c: la cuenta empieza en el
        // corte y termina la vispera del siguiente, no en un mes suelto.
        expect(cuenta.inicio).toBe(pasadoManana);
        expect(cuenta.fin > cuenta.inicio).toBe(true);

        // El motor corre sin usuario autenticado: la auditoria queda a nombre
        // del usuario de sistema.
        expect(cuenta.creado_por).toBe(USUARIO_SISTEMA);
    });

    test('Deberia cambiar a MORA despues de 6 dias del corte', async () => {
        const haceSieteDias = sumarDias(hoyEnZonaNegocio(), -7);

        const cuentaAntigua = await CuentaCobro.create({
            id_contrato: idContrato,
            detalle: 'Canon vencido',
            valor: 1000,
            inicio: haceSieteDias,
            fin: sumarDias(haceSieteDias, 29),
            estado: ESTADO_CUENTA_PENDIENTE
        });

        await procesarPagos();

        const actualizada = await CuentaCobro.findByPk(cuentaAntigua.id_cuenta_cobro);
        expect(actualizada.estado).toBe(ESTADO_CUENTA_EN_MORA);
    });

    test('al quinto dia todavia no hay mora: entra al sexto', async () => {
        // La frontera, que la suite anterior no llegaba a fijar. Sin esto,
        // adelantar la mora un dia pasaria en verde.
        const haceCincoDias = sumarDias(hoyEnZonaNegocio(), -5);

        const cuenta = await CuentaCobro.create({
            id_contrato: idContrato,
            detalle: 'Canon reciente',
            valor: 1000,
            inicio: haceCincoDias,
            fin: sumarDias(haceCincoDias, 29),
            estado: ESTADO_CUENTA_PENDIENTE
        });

        await procesarPagos();

        const actualizada = await CuentaCobro.findByPk(cuenta.id_cuenta_cobro);
        expect(actualizada.estado).toBe(ESTADO_CUENTA_PENDIENTE);
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

    test('no duplica la cuenta de cobro de un periodo ya generado', async () => {
        // Antes se comprobaba con un `date_part` sobre el mes; ahora es una
        // igualdad sobre `inicio`, respaldada ademas por un indice unico.
        const antes = await CuentaCobro.count({ where: { id_contrato: idContrato } });

        await procesarContratos();

        expect(await CuentaCobro.count({ where: { id_contrato: idContrato } })).toBe(antes);
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
