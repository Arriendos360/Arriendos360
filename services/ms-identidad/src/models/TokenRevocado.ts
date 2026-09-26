import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';

/**
 * Lista de revocación de tokens. Tabla operativa; un `jti` deja de contar cuando
 * `expira_en` queda en el pasado.
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
