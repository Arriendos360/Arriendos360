const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Contrato = require('./Contrato');

const Pago = sequelize.define('Pago', {
    id_pago: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    fecha_pago: {
        type: DataTypes.DATE
    },
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
    tipo_transaccion: {
        type: DataTypes.STRING(50)
    },
    observaciones: {
        type: DataTypes.TEXT
    },
    id_contrato: {
        type: DataTypes.INTEGER,
        references: {
            model: Contrato,
            key: 'id_contrato'
        }
    }
}, {
    tableName: 'pagos',
    timestamps: false
});

// Relación: Pago pertenece a Contrato
Pago.belongsTo(Contrato, { foreignKey: 'id_contrato' });
Contrato.hasMany(Pago, { foreignKey: 'id_contrato' });

module.exports = Pago;