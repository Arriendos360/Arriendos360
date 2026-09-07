import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';
import { Rol } from './Rol';
import { Usuario } from './Usuario';

/**
 * Tabla `RolesUsuario`: la relacion muchos a muchos, con clave primaria
 * compuesta.
 *
 * Aqui SI hay claves foraneas. La regla dura 1 prohibe las que cruzan esquemas;
 * estas tres tablas son todas de este servicio, asi que la integridad
 * referencial se puede (y se debe) delegar en la base.
 */
export class RolUsuario extends Model {
  declare id_rol: string;
  declare id_usuario: string;
  declare Rol?: Rol;
}

RolUsuario.init(
  {
    id_rol: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      references: { model: Rol, key: 'id_rol' },
    },
    id_usuario: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      references: { model: Usuario, key: 'id_usuario' },
    },
    ...columnasAuditoria,
  },
  { sequelize, tableName: 'roles_usuario', ...opcionesAuditoria },
);

registrarHooksAuditoria(RolUsuario);

Usuario.belongsToMany(Rol, { through: RolUsuario, foreignKey: 'id_usuario', otherKey: 'id_rol' });
Rol.belongsToMany(Usuario, { through: RolUsuario, foreignKey: 'id_rol', otherKey: 'id_usuario' });

// `belongsToMany` NO declara las asociaciones del modelo intermedio hacia sus
// dos extremos. Sin estas dos lineas, `RolUsuario.findAll({ include: [Rol] })`
// falla, que es justo la consulta que el login necesita para armar los claims.
RolUsuario.belongsTo(Rol, { foreignKey: 'id_rol' });
RolUsuario.belongsTo(Usuario, { foreignKey: 'id_usuario' });
