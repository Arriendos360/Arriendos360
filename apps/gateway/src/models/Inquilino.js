const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Usuario = require('./Usuario');

const Inquilino = sequelize.define('Inquilino', {
    id_inquilino: {
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
    tableName: 'inquilinos',
    timestamps: false
});

// Relación: Inquilino pertenece a Usuario
Inquilino.belongsTo(Usuario, { foreignKey: 'id_usuario' });
Usuario.hasOne(Inquilino, { foreignKey: 'id_usuario' });

module.exports = Inquilino;