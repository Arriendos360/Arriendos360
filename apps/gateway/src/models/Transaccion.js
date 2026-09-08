const { DataTypes } = require('sequelize');
const { ESTADOS_TRANSACCION, TIPOS_TRANSACCION } = require('arriendos360-contracts');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { ESTADO_TRANSACCION_CONFIRMADA, TIPO_TRANSACCION_INGRESO } = require('./constantes');
const { claveUuid } = require('./uuid');
const CuentaCobro = require('./CuentaCobro');

/**
 * Transacciones. Antes `Abono`.
 *
 * El movimiento de dinero contra una cuenta de cobro. A diferencia de las demás
 * relaciones del gateway, ésta SÍ conserva clave foránea: `transacciones` y
 * `cuentas_cobro` acaban las dos dentro de ms-financiero, así que no cruza
 * frontera de servicio.
 *
 * ── EL CAMPO QUE NO SE LLAMA COMO PARECE ─────────────────────────────────────
 *
 * `tipo_transaccion` no se convirtió en `tipo`. Guardaba "Transferencia
 * Bancaria", "Efectivo" y "Consignación", que son MEDIOS de pago; su destino es
 * `medio_pago`. `tipo` es el tipo de MOVIMIENTO —hoy siempre `INGRESO`— y es un
 * campo nuevo. Traducirlo por el parecido del nombre habría puesto "Efectivo" en
 * `tipo` y sólo se habría notado al imprimir «Forma de pago: INGRESO» en un
 * comprobante.
 *
 * ── UNA TRANSACCIÓN NO SE BORRA: SE ANULA ────────────────────────────────────
 *
 * `estado` es lo que permite corregir un registro equivocado sin falsificar el
 * historial. Anular cambia el estado y nada más: el saldo se corrige solo porque
 * la suma que lo deriva ignora las anuladas. El comprobante que ya se emitió
 * sigue existiendo y sigue diciendo lo que decía. Ver `docs/adr/0016`.
 */
const Transaccion = sequelize.define('Transaccion', {
    id_transaccion: claveUuid(),

    monto: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },

    /** Cuándo entró el dinero. Antes `fecha_abono`. */
    fecha_pago: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },

    /** Catálogo CERRADO con un solo valor. Ver `packages/contracts`. */
    tipo: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: TIPO_TRANSACCION_INGRESO,
        validate: {
            isIn: {
                args: [[...TIPOS_TRANSACCION]],
                msg: `El tipo de transacción debe ser uno de: ${TIPOS_TRANSACCION.join(', ')}`
            }
        }
    },

    /**
     * Cómo entró el dinero. Antes `tipo_transaccion`.
     *
     * Catálogo ABIERTO, el único de los cuatro de Financiero: el Capítulo 2
     * ejemplifica `TRANSFERENCIA` sin cerrar la lista, y la columna ya guarda el
     * texto libre del desplegable de la SPA. Sin `isIn` y sin `CHECK`.
     */
    medio_pago: { type: DataTypes.STRING(50) },

    /** Catálogo CERRADO. Anular no borra. */
    estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: ESTADO_TRANSACCION_CONFIRMADA,
        validate: {
            isIn: {
                args: [[...ESTADOS_TRANSACCION]],
                msg: `El estado de la transacción debe ser uno de: ${ESTADOS_TRANSACCION.join(', ')}`
            }
        }
    },

    /**
     * Referencia del movimiento, en texto libre.
     *
     * NO está en el modelo canónico y se conserva a propósito: es lo que el
     * comprobante imprime en «Referencia trans.», y sin ella ese renglón pasaría
     * a mostrar un UUID generado por el sistema en lugar del número de
     * consignación que el arrendatario tiene en su extracto. Ver
     * `docs/adr/0015`.
     */
    observaciones: { type: DataTypes.TEXT },

    /**
     * Lo que quedaba por pagar justo después de esta transacción.
     *
     * ESTO NO SE DERIVA, y es la excepción deliberada a que el saldo se calcule.
     * No es el saldo actual de la cuenta: es una FOTO del saldo en el instante
     * en que se emitió el comprobante, y ese comprobante ya está impreso en
     * casa de alguien. Recalcularla cambiaría un documento entregado.
     *
     * De ahí que anular una transacción posterior no toque esta columna en las
     * anteriores: el saldo vigente cambia, el histórico no.
     */
    saldo_restante_momento: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },

    id_cuenta_cobro: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: CuentaCobro, key: 'id_cuenta_cobro' }
    },
    ...columnasAuditoria
}, {
    tableName: 'transacciones',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Transaccion);

Transaccion.belongsTo(CuentaCobro, { foreignKey: 'id_cuenta_cobro' });
CuentaCobro.hasMany(Transaccion, { foreignKey: 'id_cuenta_cobro' });

module.exports = Transaccion;
