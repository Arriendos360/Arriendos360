import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';
import { Rol } from './Rol';
import { Usuario } from './Usuario';

/** Tabla `RolesUsuario`: relación muchos a muchos con clave primaria compuesta. */
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

// Asociaciones del modelo intermedio, necesarias para `RolUsuario.findAll({ include: [Rol] })`.
RolUsuario.belongsTo(Rol, { foreignKey: 'id_rol' });
RolUsuario.belongsTo(Usuario, { foreignKey: 'id_usuario' });
