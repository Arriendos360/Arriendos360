import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';

/**
 * Tabla `Roles`. Es catalogo, no configuracion: sus dos filas las crea la
 * migracion `002_roles_base.sql`, no la aplicacion.
 */
export class Rol extends Model {
  declare id_rol: string;
  declare nombre: string;
  declare descripcion: string | null;
}

Rol.init(
  {
    id_rol: claveUuid(),
    nombre: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    descripcion: { type: DataTypes.STRING(255) },
    ...columnasAuditoria,
  },
  { sequelize, tableName: 'roles', ...opcionesAuditoria },
);

registrarHooksAuditoria(Rol);
