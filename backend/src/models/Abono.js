const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Pago = require('./Pago');

const Abono = sequelize.define('Abono', {
    id_abono: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    monto: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    fecha_abono: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    tipo_transaccion: {
        type: DataTypes.STRING(50)
    },
    observaciones: {
        type: DataTypes.TEXT
    },
    saldo_restante_momento: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    id_pago: {
        type: DataTypes.INTEGER,
        references: {
            model: Pago,
            key: 'id_pago'
        }
    }
}, {
    tableName: 'abonos',
    timestamps: false
});

// Relación: Abono pertenece a Pago
Abono.belongsTo(Pago, { foreignKey: 'id_pago' });
Pago.hasMany(Abono, { foreignKey: 'id_pago' });

module.exports = Abono;