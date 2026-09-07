const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { referenciaUuid } = require('./uuid');
const Rol = require('./Rol');
const Usuario = require('./Usuario');

/**
 * Tabla `RolesUsuario` del modelo canónico: la relación muchos a muchos entre
 * usuarios y roles, con clave primaria compuesta.
 *
 * Aquí SÍ hay claves foráneas. La regla dura 1 prohíbe las que cruzan esquemas;
 * estas tres tablas son todas de ms-identidad, así que la integridad
 * referencial se puede (y se debe) delegar en la base.
 */
const RolUsuario = sequelize.define('RolUsuario', {
    id_rol: {
        ...referenciaUuid(),
        primaryKey: true,
        references: { model: Rol, key: 'id_rol' }
    },
    id_usuario: {
        ...referenciaUuid(),
        primaryKey: true,
        references: { model: Usuario, key: 'id_usuario' }
    },
    ...columnasAuditoria
}, {
    tableName: 'roles_usuario',
    ...opcionesAuditoria
});

registrarHooksAuditoria(RolUsuario);

Usuario.belongsToMany(Rol, { through: RolUsuario, foreignKey: 'id_usuario', otherKey: 'id_rol' });
Rol.belongsToMany(Usuario, { through: RolUsuario, foreignKey: 'id_rol', otherKey: 'id_usuario' });

// `belongsToMany` NO declara las asociaciones del modelo intermedio hacia sus
// dos extremos. Sin estas dos líneas, `RolUsuario.findAll({ include: [Rol] })`
// falla con «Rol is not associated to RolUsuario», que es justo la consulta que
// el login necesita para armar el arreglo `roles` de los claims.
RolUsuario.belongsTo(Rol, { foreignKey: 'id_rol' });
RolUsuario.belongsTo(Usuario, { foreignKey: 'id_usuario' });

module.exports = RolUsuario;
