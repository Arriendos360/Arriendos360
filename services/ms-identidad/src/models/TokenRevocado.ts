import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';

/**
 * Lista de revocacion de tokens.
 *
 * Tabla operativa de seguridad, no de dominio: por eso no lleva columnas de
 * auditoria. Un `jti` deja de tener efecto cuando `expira_en` queda en el
 * pasado, asi que el Capitulo 2 descarta el barrido programado.
 */
export class TokenRevocado extends Model {
  declare jti: string;
  declare expira_en: Date;
}

TokenRevocado.init(
  {
    jti: { type: DataTypes.UUID, primaryKey: true },
    expira_en: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: 'tokens_revocados', timestamps: false },
);
