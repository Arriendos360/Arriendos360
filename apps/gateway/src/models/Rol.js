const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { claveUuid } = require('./uuid');

/**
 * Tabla `Roles` del modelo canónico.
 *
 * Es catálogo, no configuración de usuario: sus dos filas (PROPIETARIO e
 * INQUILINO) las crea la migración `identidad/002_roles_base.sql`, no la
 * aplicación.
 */
const Rol = sequelize.define('Rol', {
    id_rol: claveUuid(),
    nombre: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true
    },
    descripcion: {
        type: DataTypes.STRING(255)
    },
    ...columnasAuditoria
}, {
    tableName: 'roles',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Rol);

module.exports = Rol;
