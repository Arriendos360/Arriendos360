const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { claveUuid } = require('./uuid');
const Pago = require('./Pago');

/**
 * Abonos.
 *
 * Futuras `Transacciones`. A diferencia de las demás relaciones de este archivo,
 * ésta SÍ conserva clave foránea: `abonos` y `pagos` acaban las dos dentro de
 * ms-financiero, así que no cruza frontera de servicio.
 */
const Abono = sequelize.define('Abono', {
    id_abono: claveUuid(),
    monto: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    fecha_abono: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    tipo_transaccion: { type: DataTypes.STRING(50) },
    observaciones: { type: DataTypes.TEXT },
    saldo_restante_momento: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    id_pago: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: Pago, key: 'id_pago' }
    },
    ...columnasAuditoria
}, {
    tableName: 'abonos',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Abono);

Abono.belongsTo(Pago, { foreignKey: 'id_pago' });
Pago.hasMany(Abono, { foreignKey: 'id_pago' });

module.exports = Abono;
