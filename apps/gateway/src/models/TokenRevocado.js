const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');

/**
 * Lista de revocación de tokens.
 *
 * Es tabla operativa de seguridad, no de dominio: por eso no lleva las columnas
 * de auditoría. `expira_en` es la expiración natural del propio token, así que
 * una fila vencida deja de tener efecto aunque siga ahí. El Capítulo 2 descarta
 * el barrido programado por eso mismo; con tokens de una hora el volumen es
 * despreciable.
 */
const TokenRevocado = sequelize.define('TokenRevocado', {
    jti: {
        type: DataTypes.UUID,
        primaryKey: true
    },
    expira_en: {
        type: DataTypes.DATE,
        allowNull: false
    }
}, {
    tableName: 'tokens_revocados',
    timestamps: false
});

module.exports = TokenRevocado;
