const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { claveUuid, referenciaUuid } = require('./uuid');
const Contrato = require('./Contrato');

/**
 * Pagos.
 *
 * En el modelo canónico esta tabla se convierte en `Cuentas_cobro` y su columna
 * `tipo_transaccion` se va a `Transacciones`. Separar los dos conceptos es el
 * trabajo del paso 6 y no se toca aquí: este PR sólo cambia identificadores y
 * auditoría.
 */
const Pago = sequelize.define('Pago', {
    id_pago: claveUuid(),
    fecha_pago: { type: DataTypes.DATE },
    monto_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    saldo_pendiente: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0
    },
    mes_correspondiente: {
        type: DataTypes.DATE,
        allowNull: false
    },
    estado: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    tipo_transaccion: { type: DataTypes.STRING(50) },
    observaciones: { type: DataTypes.TEXT },
    id_contrato: referenciaUuid(),
    ...columnasAuditoria
}, {
    tableName: 'pagos',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Pago);

// Referencia lógica: `id_contrato` cruzará de ms-financiero a ms-contratos.
Pago.belongsTo(Contrato, { foreignKey: 'id_contrato', constraints: false });
Contrato.hasMany(Pago, { foreignKey: 'id_contrato', constraints: false });

module.exports = Pago;
