import { DataTypes, Model } from 'sequelize';
import { ESTADOS_CUENTA_COBRO } from 'arriendos360-contracts';

import { sequelize } from '../config/database';
import {
  claveUuid,
  columnasAuditoria,
  opcionesAuditoria,
  registrarHooksAuditoria,
} from './columnas';
import { ESTADO_CUENTA_PENDIENTE } from './constantes';

/**
 * Tabla `Cuentas_cobro`: la factura de un periodo. No tiene columna de saldo: se
 * deriva en `services/saldos.ts`. `id_contrato` es una referencia sin clave foránea.
 */
export class CuentaCobro extends Model {
  declare id_cuenta_cobro: string;
  declare detalle: string;
  declare valor: number | string;
  declare inicio: string;
  declare fin: string;
  declare fecha_pago: Date | null;
  declare estado: string;
  declare id_contrato: string;
  declare creado_por: string;
  declare actualizado_por: string;
}

CuentaCobro.init(
  {
    id_cuenta_cobro: claveUuid(),

    /** Concepto del cobro. Lo escribe quien la genera, con el periodo. */
    detalle: { type: DataTypes.TEXT, allowNull: false },

    /** Lo que se factura. */
    valor: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

    /** Periodo que cubre la cuenta, calculado con `periodoDeCorte()`. `DATEONLY`. */
    inicio: { type: DataTypes.DATEONLY, allowNull: false },
    fin: { type: DataTypes.DATEONLY, allowNull: false },

    /** Momento en que la cuenta quedo cubierta. Nulo mientras no lo este. */
    fecha_pago: { type: DataTypes.DATE },

    /** Catálogo cerrado. `EN_MORA` sólo se abandona pagando la cuenta entera. */
    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: ESTADO_CUENTA_PENDIENTE,
      validate: {
        isIn: {
          args: [[...ESTADOS_CUENTA_COBRO]],
          msg: `El estado de la cuenta de cobro debe ser uno de: ${ESTADOS_CUENTA_COBRO.join(
            ', ',
          )}`,
        },
      },
    },

    id_contrato: { type: DataTypes.UUID, allowNull: false },
    ...columnasAuditoria,
  },
  {
    sequelize,
    modelName: 'CuentaCobro',
    tableName: 'cuentas_cobro',
    ...opcionesAuditoria,
  },
);

registrarHooksAuditoria(CuentaCobro);
