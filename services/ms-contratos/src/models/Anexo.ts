import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';
import { Contrato } from './Contrato';

/**
 * Tabla `Anexos`. `archivo_anexo` es la referencia opaca del almacenamiento;
 * `tipo` es un catálogo abierto, sin validación.
 */
export class Anexo extends Model {
  declare id_anexo: string;
  declare archivo_anexo: string;
  declare tipo: string;
  declare id_contrato: string;
  declare creado_por: string;
  declare actualizado_por: string;
}

Anexo.init(
  {
    id_anexo: claveUuid(),
    archivo_anexo: { type: DataTypes.STRING(500), allowNull: false },
    tipo: { type: DataTypes.STRING(50), allowNull: false },
    id_contrato: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Contrato, key: 'id_contrato' },
    },
    ...columnasAuditoria,
  },
  {
    sequelize,
    modelName: 'Anexo',
    tableName: 'anexos',
    ...opcionesAuditoria,
  },
);

registrarHooksAuditoria(Anexo);

// Asociación dentro del mismo esquema.
Anexo.belongsTo(Contrato, { foreignKey: 'id_contrato' });
Contrato.hasMany(Anexo, { foreignKey: 'id_contrato' });
