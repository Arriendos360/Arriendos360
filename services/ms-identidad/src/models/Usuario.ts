import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';

/** Tabla `Usuarios`. Propietario e inquilino son roles en `RolesUsuario`. */
export class Usuario extends Model {
  declare id_usuario: string;
  declare nombres: string;
  declare apellidos: string;
  declare email: string;
  /** Hash bcrypt. */
  declare contrasena: string;
  declare telefono: string | null;
  declare documento: string;
  /** Marca a quien no eligió su propia contraseña. */
  declare debe_cambiar_contrasena: boolean;
  /** Último cambio de contraseña; todo token emitido antes deja de valer. */
  declare contrasena_cambiada_en: Date | null;
  declare creado_por: string;
  declare actualizado_por: string;
}

Usuario.init(
  {
    id_usuario: claveUuid(),
    nombres: { type: DataTypes.STRING(100), allowNull: false },
    apellidos: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(150), allowNull: false, unique: true },
    contrasena: { type: DataTypes.STRING(255), allowNull: false },
    telefono: { type: DataTypes.STRING(15) },
    documento: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    debe_cambiar_contrasena: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    contrasena_cambiada_en: { type: DataTypes.DATE },
    ...columnasAuditoria,
  },
  { sequelize, tableName: 'usuarios', ...opcionesAuditoria },
);

registrarHooksAuditoria(Usuario);
