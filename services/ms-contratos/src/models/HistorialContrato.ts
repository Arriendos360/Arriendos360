import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { claveUuid } from './columnas';
import { Contrato } from './Contrato';

/**
 * Tabla `historial_contratos`: una fila por cambio de un campo editable o del estado. Sólo se
 * agrega, así que no lleva las columnas de modificación de la auditoría.
 */
export class HistorialContrato extends Model {
  declare id_historial: string;
  declare id_contrato: string;
  declare campo: string;
  declare valor_anterior: string | null;
  declare valor_nuevo: string | null;
  declare motivo: string | null;
  declare indemnizacion: string | null;
  declare indemnizacion_a_cargo_de: string | null;
  declare cambiado_en: Date;
  declare cambiado_por: string;
}

HistorialContrato.init(
  {
    id_historial: claveUuid(),
    id_contrato: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Contrato, key: 'id_contrato' },
    },
    campo: { type: DataTypes.STRING(40), allowNull: false },
    valor_anterior: { type: DataTypes.TEXT, allowNull: true },
    valor_nuevo: { type: DataTypes.TEXT, allowNull: true },
    motivo: { type: DataTypes.STRING(40), allowNull: true },
    indemnizacion: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    indemnizacion_a_cargo_de: { type: DataTypes.STRING(12), allowNull: true },
    cambiado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    cambiado_por: { type: DataTypes.UUID, allowNull: false },
  },
  {
    sequelize,
    modelName: 'HistorialContrato',
    tableName: 'historial_contratos',
    timestamps: false,
  },
);
