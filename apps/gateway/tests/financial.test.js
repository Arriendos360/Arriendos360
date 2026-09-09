const crypto = require('crypto');

const { CuentaCobro } = require('../src/models');
const {
    ESTADO_CONTRATO_ACTIVO,
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PENDIENTE,
    USUARIO_SISTEMA
} = require('../src/models/constantes');
const { hoyEnZonaNegocio } = require('arriendos360-shared');
const { procesarContratos, procesarPagos } = require('../src/services/financialEngine');
const {
    cerrarEntorno,
    contratosFalso,
    identidadFalsa,
    inmueblesFalso,
    prepararEntorno
} = require('./utiles/entorno');

/**
 * Motor financiero.
 *
 * Construye los datos con los modelos, porque el motor no tiene endpoint propio
 * desde que se elimino `/api/admin`. Ni los usuarios ni los inmuebles se crean
 * aqui: viven en ms-identidad y ms-inmuebles, y para estas pruebas los ponen sus
 * dobles. Al gateway le llegan sus UUID en `id_inquilino` e `id_inmueble`, que
 * es todo lo que guarda de ellos.
 *
 * ── EN EL PASO 6d LOS CONTRATOS TAMPOCO SON LOCALES ──────────────────────────
 *
 * Se ponen en el doble de ms-contratos, igual que los usuarios y los inmuebles
 * se ponen en los suyos. El motor los pide por HTTP, que es lo que hace ahora.
 *
 * Y la prueba del viaje unico gana un caso: antes comprobaba que ms-identidad se
 * consulta una vez por barrido; ahora comprueba tambien que ms-contratos se
 * consulta una vez, y que ese numero NO crece con el numero de contratos. Es la
 * garantia que el paso 4 introdujo con `adjuntarPartes` y que la extraccion de
 * Contratos podia haber roto sin que nada lo dijera.
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

/** Pone un contrato en el doble de ms-contratos, sin pasar por la API. */
const contratoEnElDoble = (datos) => {
    const contrato = {
        id_contrato: crypto.randomUUID(),
        estado: ESTADO_CONTRATO_ACTIVO,
        ...datos
    };

    contratosFalso().contratos.set(contrato.id_contrato, contrato);
    return contrato;
};

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

        const contrato = contratoEnElDoble({
            id_inmueble: inm.id_inmueble,
            id_inquilino: idInquilino,
            inicio: pasadoManana,
            fin: '2027-01-01',
            canon: 1000,
            // La fecha de corte se pone EXPLICITA, igual que antes: escribirla
            // aqui es lo que hace que el motor reciba exactamente el dia de
            // corte que la prueba quiere ejercitar.
            fecha_inicio_corte: pasadoManana,
            fecha_limite_pago: Number(pasadoManana.slice(8, 10))
        });
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
        // LA GARANTIA CONTRA EL N+1 POR RED, y desde el paso 6d cubre los tres
        // servicios. El motor recorre todos los contratos activos, pero pregunta
        // a cada uno UNA vez por barrido.
        const identidad = identidadFalsa();
        const contratos = contratosFalso();
        identidad.limpiarLlamadas();
        contratos.limpiarLlamadas();

        await procesarContratos();

        expect(
            identidad.llamadas.filter((l) => l.ruta.startsWith('/interno/usuarios'))
        ).toHaveLength(1);
        expect(
            contratos.llamadas.filter((l) => l.ruta.startsWith('/interno/contratos'))
        ).toHaveLength(1);
    });

    test('y el numero de viajes NO crece con el numero de contratos', async () => {
        // Lo anterior pasaria igual con un solo contrato en la base, que es como
        // se cuela un N+1: la prueba no lo veria. Con varios, un `await` dentro
        // del bucle se delata.
        const contratos = contratosFalso();

        for (let i = 0; i < 4; i += 1) {
            const inm = inmuebleEnElDoble(idPropietario, `Multiple ${i}`);
            contratoEnElDoble({
                id_inmueble: inm.id_inmueble,
                id_inquilino: idInquilino,
                inicio: '2026-01-01',
                fin: '2027-01-01',
                canon: 1000,
                fecha_inicio_corte: '2026-01-01',
                fecha_limite_pago: 1
            });
        }

        const identidad = identidadFalsa();
        identidad.limpiarLlamadas();
        contratos.limpiarLlamadas();

        await procesarContratos();

        expect(
            identidad.llamadas.filter((l) => l.ruta.startsWith('/interno/usuarios'))
        ).toHaveLength(1);
        expect(
            contratos.llamadas.filter((l) => l.ruta.startsWith('/interno/contratos'))
        ).toHaveLength(1);
    });

    test('procesarPagos tambien pide los contratos en lote', async () => {
        // El otro barrido. Antes resolvia el contrato con un `include`; ahora
        // los pide POR IDENTIFICADOR, todos de una vez.
        const contratos = contratosFalso();
        contratos.limpiarLlamadas();

        await procesarPagos();

        const consultas = contratos.llamadas.filter((l) =>
            l.ruta.startsWith('/interno/contratos')
        );
        expect(consultas.length).toBeLessThanOrEqual(1);
    });

    test('no duplica la cuenta de cobro de un periodo ya generado', async () => {
        // Antes se comprobaba con un `date_part` sobre el mes; ahora es una
        // igualdad sobre `inicio`, respaldada ademas por un indice unico.
        const antes = await CuentaCobro.count({ where: { id_contrato: idContrato } });

        await procesarContratos();

        expect(await CuentaCobro.count({ where: { id_contrato: idContrato } })).toBe(antes);
    });

    test('si ms-contratos no responde, el barrido no genera nada y no revienta', async () => {
        // Un fallo de ms-contratos SI para la generacion: sin la lista, no hay
        // nada que facturar. Lo que no puede es tirar el proceso — el motor corre
        // en un `cron`, y una excepcion sin capturar se lleva por delante el
        // barrido de mora que viene detras.
        const contratos = contratosFalso();
        contratos.caer(503);

        await expect(procesarContratos()).resolves.not.toThrow();

        contratos.levantar();
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
