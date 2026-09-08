const { DataTypes } = require('sequelize');
const { ESTADOS_CUENTA_COBRO } = require('arriendos360-contracts');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { ESTADO_CUENTA_PENDIENTE } = require('./constantes');
const { claveUuid, referenciaUuid } = require('./uuid');

/**
 * Cuentas de cobro. Antes `Pago`.
 *
 * NO ES UN RENOMBRE. `pagos` mezclaba dos conceptos que el modelo canónico
 * separa: la FACTURA mensual que el sistema genera solo, que es esto, y el
 * MOVIMIENTO de dinero contra ella, que es `Transaccion`. La columna
 * `tipo_transaccion` que tenía esta tabla era del segundo concepto y se fue
 * donde le corresponde; `monto_total` pasó a `valor`, que es lo que se factura.
 *
 * ── NO HAY COLUMNA DE SALDO, Y ES DELIBERADO ─────────────────────────────────
 *
 * `saldo_pendiente` existía y se actualizaba a mano en cada abono. Un dato
 * derivado que se guarda es un dato que puede mentir: bastaba un abono escrito
 * por otro camino —una corrección a mano en la base, un proceso futuro— para que
 * la columna y las transacciones dejaran de cuadrar, sin que nada lo delatara.
 *
 * El saldo se calcula: `valor` menos la suma de las transacciones CONFIRMADAS.
 * `services/saldos.js` lo hace en una sola consulta para toda una lista y lo
 * adjunta como `saldo_pendiente`, así que las respuestas de la API siguen
 * llevando el mismo campo con el mismo nombre. Lo que cambió es de dónde sale.
 *
 * Consecuencia visible, y es la buena: anular una transacción no tiene que
 * «devolver» nada. El saldo se corrige solo porque la suma deja de contarla.
 *
 * `id_contrato` es una referencia lógica pura: cruza a ms-contratos y por eso no
 * lleva clave foránea (regla dura 1). Desde el paso 6d TAMPOCO lleva asociación
 * de Sequelize — el contrato dejó de estar en esta base, así que no hay
 * `include` que valga y la regla dura 2 lo prohibiría igualmente. Lo que hacía
 * falta de él se compone por HTTP (`clientes/contratos.js`).
 */
const CuentaCobro = sequelize.define('CuentaCobro', {
    id_cuenta_cobro: claveUuid(),

    /** Concepto del cobro. Lo escribe el motor con el periodo que factura. */
    detalle: {
        type: DataTypes.TEXT,
        allowNull: false
    },

    /** Lo que se factura. Antes `monto_total`. */
    valor: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },

    /**
     * El periodo que cubre la cuenta, explícito.
     *
     * Sustituye a `mes_correspondiente`, que era un solo instante y obligaba a
     * adivinar dónde acababa el ciclo. `DATEONLY` por lo mismo que
     * `contratos.fecha_inicio_corte`: son fechas de calendario y un `TIMESTAMPTZ`
     * leído con `.getDate()` las movería un día en Bogotá.
     *
     * La regla que las relaciona está en `packages/shared`, en `periodoDeCorte()`,
     * y no se calcula en ningún otro sitio. Subió al paquete compartido en el
     * paso 6d, cuando Contratos y Financiero dejaron de vivir en el mismo
     * proceso: duplicar la regla del día 31 habría sido tener dos calendarios.
     */
    inicio: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    fin: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },

    /** Momento en que la cuenta quedó cubierta. Nulo mientras no lo esté. */
    fecha_pago: { type: DataTypes.DATE },

    /**
     * Catálogo CERRADO, en `packages/contracts`. Sustituye a los enteros 1, 2, 4
     * y 3 —en ese orden— cuyo significado no estaba escrito en ninguna parte.
     *
     * `EN_MORA` es un estado de vencimiento, no de pago, y por eso gana sobre
     * `PARCIAL`: una cuenta abonada a medias que pasó el sexto día sigue en
     * mora. De ahí sólo se sale pagándola entera. Ver `services/saldos.js`.
     */
    estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: ESTADO_CUENTA_PENDIENTE,
        validate: {
            isIn: {
                args: [[...ESTADOS_CUENTA_COBRO]],
                msg: `El estado de la cuenta de cobro debe ser uno de: ${ESTADOS_CUENTA_COBRO.join(', ')}`
            }
        }
    },

    id_contrato: referenciaUuid(),
    ...columnasAuditoria
}, {
    tableName: 'cuentas_cobro',
    ...opcionesAuditoria
});

registrarHooksAuditoria(CuentaCobro);

// AQUI HABIA UN `belongsTo(Contrato)`. Se fue con el paso 6d: `contratos` vive
// ahora en otro esquema y en otro servicio, asi que el `include` que esa
// asociacion permitia ya no es posible — ni deberia serlo, porque cruzaba la
// frontera de un bounded context (regla dura 2). Todo lo que dependia de el se
// resuelve componiendo en el controlador.

module.exports = CuentaCobro;
