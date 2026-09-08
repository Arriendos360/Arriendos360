/**
 * El saldo de una cuenta de cobro, derivado.
 *
 * Hasta el paso 6c esto era una columna, `pagos.saldo_pendiente`, que el
 * controlador restaba a mano en cada abono. El modelo canónico no la tiene, y
 * hace bien: el saldo es `valor` menos lo cobrado, y guardar el resultado de una
 * resta obliga a que todo camino de escritura se acuerde de rehacerla. El día
 * que uno se olvide —o que alguien corrija una fila a mano— la columna y las
 * transacciones dicen cosas distintas y nada lo delata.
 *
 * Aquí se calcula, y en un solo sitio. Todo lo demás lo consume:
 *
 *   - los controladores, que lo adjuntan a la respuesta como `saldo_pendiente`
 *     para que el frontend siga recibiendo el mismo campo;
 *   - el registro de una transacción, que lo necesita para no aceptar un
 *     sobrepago;
 *   - la anulación, que no tiene que devolver nada: el saldo se corrige solo
 *     porque la suma deja de contar la transacción anulada.
 *
 * ── SÓLO CUENTAN LAS CONFIRMADAS ─────────────────────────────────────────────
 *
 * Es toda la definición, y es lo que hace que anular funcione sin tocar más
 * datos que un `estado`.
 *
 * ── UN VIAJE POR LISTA, NO UNO POR CUENTA ────────────────────────────────────
 *
 * `conSaldos()` resuelve una lista entera con UNA consulta agrupada. La misma
 * disciplina que `clientes/composicion.js` aplica a las llamadas de red: la
 * pantalla de Pagos pide todas las cuentas del propietario de golpe, y una
 * consulta por fila convertiría la lista en el sitio más lento de la aplicación.
 */

const { Op, col, fn } = require('sequelize');

const { Transaccion } = require('../models');
const {
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PAGADA,
    ESTADO_CUENTA_PARCIAL,
    ESTADO_CUENTA_PENDIENTE,
    ESTADO_TRANSACCION_CONFIRMADA
} = require('../models/constantes');

/**
 * Redondeo a dos decimales, que es la precisión de la columna.
 *
 * `NUMERIC(12,2)` llega a JavaScript como cadena y se opera como `Number`, que
 * es binario: restar 1000 menos 400 menos 600 puede dar `1.1368683772161603e-13`
 * en vez de `0`, y entonces `saldo <= 0` sigue siendo cierto pero la respuesta
 * lleva ese número en `saldo_pendiente` y el frontend lo pinta. La suma la hace
 * PostgreSQL en `NUMERIC` y es exacta; lo que se redondea es la resta final.
 */
const redondear = (valor) => Math.round(valor * 100) / 100;

/** Convierte una instancia de Sequelize en objeto plano, o lo deja pasar. */
const aPlano = (entidad) => (entidad && typeof entidad.toJSON === 'function' ? entidad.toJSON() : entidad);

/**
 * Lo cobrado y confirmado contra cada una de esas cuentas.
 *
 * @param {string[]} ids identificadores de cuenta de cobro
 * @param {object} [opciones] `transaction`, para leer dentro de una transacción
 * @returns {Promise<Map<string, number>>} id -> total confirmado (0 si no hay)
 */
const cobradoPorCuenta = async (ids, opciones = {}) => {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (unicos.length === 0) {
        return new Map();
    }

    const filas = await Transaccion.findAll({
        attributes: ['id_cuenta_cobro', [fn('SUM', col('monto')), 'cobrado']],
        where: { id_cuenta_cobro: { [Op.in]: unicos }, estado: ESTADO_TRANSACCION_CONFIRMADA },
        group: ['id_cuenta_cobro'],
        raw: true,
        ...opciones
    });

    return new Map(filas.map((fila) => [fila.id_cuenta_cobro, parseFloat(fila.cobrado)]));
};

/**
 * El saldo de UNA cuenta, leído dentro de una transacción.
 *
 * Lo usan el registro y la anulación, que necesitan el valor con el bloqueo de
 * la transacción en curso y no pueden fiarse de una lectura anterior.
 *
 * @param {object} cuenta instancia de CuentaCobro
 * @param {object} [opciones] `transaction`
 * @returns {Promise<number>}
 */
const saldoDe = async (cuenta, opciones = {}) => {
    const cobrado = await cobradoPorCuenta([cuenta.id_cuenta_cobro], opciones);
    return redondear(parseFloat(cuenta.valor) - (cobrado.get(cuenta.id_cuenta_cobro) || 0));
};

/**
 * Adjunta `saldo_pendiente` a una lista de cuentas de cobro.
 *
 * El nombre del campo es el de la columna que desapareció, a propósito: el
 * frontend y los PDF lo leen con ese nombre y no tienen por qué enterarse de que
 * ahora se calcula.
 *
 * @param {Array} cuentas instancias o planos
 * @returns {Promise<Array>} las mismas cuentas, planas y con `saldo_pendiente`
 */
const conSaldos = async (cuentas) => {
    const lista = (cuentas || []).map(aPlano);
    const cobrado = await cobradoPorCuenta(lista.map((c) => c.id_cuenta_cobro));

    return lista.map((cuenta) => ({
        ...cuenta,
        saldo_pendiente: redondear(parseFloat(cuenta.valor) - (cobrado.get(cuenta.id_cuenta_cobro) || 0))
    }));
};

/** Adjunta `saldo_pendiente` a una sola cuenta. */
const conSaldo = async (cuenta) => {
    if (!cuenta) {
        return cuenta;
    }

    const [conElSaldo] = await conSaldos([cuenta]);
    return conElSaldo;
};

/**
 * Adjunta `saldo_pendiente` a la cuenta de cobro ANIDADA de una lista.
 *
 * Existe por lo mismo que `adjuntarInmuebleAlContratoAnidado`: una transacción
 * no tiene saldo propio, cuelga de una cuenta que sí lo tiene, y el comprobante
 * y el historial leen esa ruta.
 *
 * @param {Array} elementos transacciones
 * @param {(elemento: object) => object|null|undefined} camino cómo llegar a la cuenta
 */
const conSaldoAnidado = async (elementos, camino) => {
    const lista = (elementos || []).map(aPlano);
    const cuentas = lista.map((elemento) => camino(elemento)).filter(Boolean);
    const cobrado = await cobradoPorCuenta(cuentas.map((c) => c.id_cuenta_cobro));

    for (const elemento of lista) {
        const cuenta = camino(elemento);
        if (cuenta) {
            cuenta.saldo_pendiente = redondear(
                parseFloat(cuenta.valor) - (cobrado.get(cuenta.id_cuenta_cobro) || 0)
            );
        }
    }

    return lista;
};

/**
 * El estado que le corresponde a una cuenta con este saldo.
 *
 * ES LA MISMA REGLA QUE APLICABA EL CONTROLADOR con los enteros, escrita entera
 * en un sitio en vez de en un ternario anidado dentro de `registrarPago`:
 *
 *   saldo 0            -> PAGADA
 *   venía de EN_MORA   -> sigue EN_MORA, se haya abonado o no
 *   saldo == valor     -> PENDIENTE  (no se ha cobrado nada)
 *   0 < saldo < valor  -> PARCIAL
 *
 * `EN_MORA` gana sobre `PARCIAL` porque no dice lo mismo: uno habla de cuánto se
 * ha pagado y el otro de si llegó a tiempo. Abonar la mitad de una cuenta
 * vencida no la pone al día.
 *
 * Que sea una FUNCIÓN DEL SALDO y no una secuencia de transiciones es lo que
 * hace que anular funcione: se recalcula con el saldo nuevo y la cuenta vuelve
 * exactamente al estado que tenía antes de la transacción que se anuló, sin
 * guardar en ninguna parte cuál era.
 *
 * @param {number|string} valor  lo facturado
 * @param {number} saldo         lo que queda por cobrar
 * @param {string} estadoActual  el estado que tiene ahora
 */
const estadoSegunSaldo = (valor, saldo, estadoActual) => {
    if (saldo <= 0) {
        return ESTADO_CUENTA_PAGADA;
    }

    if (estadoActual === ESTADO_CUENTA_EN_MORA) {
        return ESTADO_CUENTA_EN_MORA;
    }

    return saldo >= parseFloat(valor) ? ESTADO_CUENTA_PENDIENTE : ESTADO_CUENTA_PARCIAL;
};

/**
 * `fecha_pago` de la cuenta: cuándo quedó cubierta, o `null` si no lo está.
 *
 * ESTO CAMBIA DE COMPORTAMIENTO, y hay que decirlo. Antes la escribía cualquier
 * abono sin mirar el saldo, así que una cuenta pagada a medias quedaba con fecha
 * de pago puesta. Nadie leía la columna —ni el frontend, ni los PDF, ni el
 * dashboard— así que el defecto no se veía; pero con la anulación en pie sí
 * importa: una cuenta que vuelve a PENDIENTE porque se anuló lo único que se le
 * había abonado no puede seguir diciendo cuándo se pagó.
 *
 * Se decide con el mismo dato que el estado, y por eso vive al lado.
 */
const fechaPagoSegunSaldo = (saldo, momento) => (saldo <= 0 ? momento : null);

module.exports = {
    cobradoPorCuenta,
    conSaldo,
    conSaldoAnidado,
    conSaldos,
    estadoSegunSaldo,
    fechaPagoSegunSaldo,
    saldoDe
};
