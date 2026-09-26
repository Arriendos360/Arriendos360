import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { claveUuid } from './columnas';
import { Usuario } from './Usuario';

/** Token de recuperación de contraseña. Tabla operativa: guarda el hash, nunca el token. */
export class TokenRecuperacion extends Model {
  declare id_token: string;
  /** SHA-256 hexadecimal del token enviado. */
  declare hash_token: string;
  declare id_usuario: string;
  declare expira_en: Date;
  /** Marca de uso. Un enlace ya usado no vuelve a servir. */
  declare usado_en: Date | null;
  declare creado_en: Date;
}

TokenRecuperacion.init(
  {
    id_token: claveUuid(),
    hash_token: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    id_usuario: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Usuario, key: 'id_usuario' },
    },
    expira_en: { type: DataTypes.DATE, allowNull: false },
    usado_en: { type: DataTypes.DATE },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'tokens_recuperacion', timestamps: false },
);

TokenRecuperacion.belongsTo(Usuario, { foreignKey: 'id_usuario' });
