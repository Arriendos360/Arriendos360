const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { claveUuid } = require('./uuid');

/**
 * Tabla `Usuarios` del modelo canónico.
 *
 * Sustituye a la trinidad `Usuario` + `Propietario` + `Inquilino`. La distinción
 * entre propietario e inquilino ya no es una tabla ni una columna: es una fila
 * en `RolesUsuario`, y por eso un mismo usuario puede ser las dos cosas.
 *
 * Dos renombres respecto al modelo viejo, ambos del Capítulo 2:
 *   `correo`          -> `email`
 *   `hash_contrasena` -> `contrasena`   (sigue guardando el hash bcrypt)
 */
const Usuario = sequelize.define('Usuario', {
    id_usuario: claveUuid(),
    nombres: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    apellidos: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    email: {
        type: DataTypes.STRING(150),
        allowNull: false,
        unique: true
    },
    contrasena: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    telefono: {
        type: DataTypes.STRING(15)
    },
    documento: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    ...columnasAuditoria
}, {
    tableName: 'usuarios',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Usuario);

module.exports = Usuario;
