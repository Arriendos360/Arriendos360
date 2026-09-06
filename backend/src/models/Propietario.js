const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Usuario = require('./Usuario');

const Propietario = sequelize.define('Propietario', {
    id_propietario: {
        type: DataTypes.STRING(20),
        primaryKey: true
    },
    id_usuario: {
        type: DataTypes.INTEGER,
        references: {
            model: Usuario,
            key: 'id_usuario'
        }
    }
}, {
    tableName: 'propietarios',
    timestamps: false
});

// Relación: Propietario pertenece a Usuario
Propietario.belongsTo(Usuario, { foreignKey: 'id_usuario' });
Usuario.hasOne(Propietario, { foreignKey: 'id_usuario' });

module.exports = Propietario;