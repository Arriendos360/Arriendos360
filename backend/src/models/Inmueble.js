const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Propietario = require('./Propietario');

const Inmueble = sequelize.define('Inmueble', {
    id_inmueble: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    departamento: {
        type: DataTypes.STRING(100)
    },
    municipio: {
        type: DataTypes.STRING(100)
    },
    barrio: {
        type: DataTypes.STRING(100)
    },
    direccion: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    tipo_inmueble: {
        type: DataTypes.STRING(50)
    },
    area_m2: {
        type: DataTypes.DECIMAL(10, 2)
    },
    habitaciones: {
        type: DataTypes.INTEGER
    },
    banos: {
        type: DataTypes.INTEGER
    },
    deposito: {
        type: DataTypes.INTEGER
    },
    parqueaderos: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    estrato: {
        type: DataTypes.INTEGER
    },
    estado_ocupacion: {
        type: DataTypes.STRING(20),
        defaultValue: 'disponible'
    },
    id_propietario: {
        type: DataTypes.STRING(20),
        references: {
            model: Propietario,
            key: 'id_propietario'
        }
    }
}, {
    tableName: 'inmuebles',
    timestamps: false
});

// Relación: Inmueble pertenece a Propietario
Inmueble.belongsTo(Propietario, { foreignKey: 'id_propietario' });
Propietario.hasMany(Inmueble, { foreignKey: 'id_propietario' });

module.exports = Inmueble;