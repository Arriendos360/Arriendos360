import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { claveUuid } from './columnas';

/**
 * Rastro de quien consulto que documento y cuando.
 *
 * Tabla operativa, no de dominio: sin columnas de auditoria (seria redundante
 * consigo misma) y sin exposicion por API. Ver `database/003_consultas_documento.sql`.
 */
export class ConsultaDocumento extends Model {
  declare id_consulta: string;
  declare id_consultante: string;
  declare documento: string;
  declare encontrado: boolean;
  declare consultada_en: Date;
}

ConsultaDocumento.init(
  {
    id_consulta: claveUuid(),
    id_consultante: { type: DataTypes.UUID, allowNull: false },
    documento: { type: DataTypes.STRING(20), allowNull: false },
    encontrado: { type: DataTypes.BOOLEAN, allowNull: false },
    consultada_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'consultas_documento', timestamps: false },
);
