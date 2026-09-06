const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Inmueble = require('./Inmueble');
const Inquilino = require('./Inquilino');

const Contrato = sequelize.define('Contrato', {
    id_contrato: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    fecha_inicio: {
        type: DataTypes.DATE,
        allowNull: false
    },
    fecha_fin: {
        type: DataTypes.DATE,
        allowNull: false
    },
    valor_mensual: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    deposito: {
        type: DataTypes.DECIMAL(12, 2)
    },
    estado: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    url_pdf: {
        type: DataTypes.STRING(500)
    },
    inventario_fotografico: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    id_inmueble: {
        type: DataTypes.INTEGER,
        references: {
            model: Inmueble,
            key: 'id_inmueble'
        }
    },
    id_inquilino: {
        type: DataTypes.STRING(20),
        references: {
            model: Inquilino,
            key: 'id_inquilino'
        }
    }
}, {
    tableName: 'contratos',
    timestamps: false
});

// Relaciones
Contrato.belongsTo(Inmueble, { foreignKey: 'id_inmueble' });
Inmueble.hasMany(Contrato, { foreignKey: 'id_inmueble' });

Contrato.belongsTo(Inquilino, { foreignKey: 'id_inquilino' });
Inquilino.hasMany(Contrato, { foreignKey: 'id_inquilino' });

module.exports = Contrato;