import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';
import { Contrato } from './Contrato';

/**
 * Anexos: los archivos que acompañan a un contrato.
 *
 * `archivo_anexo` NO es una ruta: es la referencia que devuelve el
 * almacenamiento, y solo el sabe interpretarla. Ver `services/almacenamiento.ts`.
 *
 * `tipo` es un enum ABIERTO. El Capitulo 2 enumera `CONTRATO_FIRMADO` y `OTROSI`
 * seguidos de «etc.», asi que no hay `isIn` ni `CHECK`: los valores conocidos
 * viven en `packages/contracts` como sugerencia. Es deliberadamente distinto de
 * `inmuebles.tipo`, que si es un catalogo cerrado.
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

/**
 * ESTA SI es una asociacion de verdad, y es la unica del servicio.
 *
 * `Anexos` y `Contratos` son las dos tablas de ms-contratos y viven en el mismo
 * esquema, asi que la clave foranea no cruza la frontera de ningun servicio y la
 * regla dura 1 no aplica.
 */
Anexo.belongsTo(Contrato, { foreignKey: 'id_contrato' });
Contrato.hasMany(Anexo, { foreignKey: 'id_contrato' });
