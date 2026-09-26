import { DataTypes, Model } from 'sequelize';
import { ESTADOS_TRANSACCION, TIPOS_TRANSACCION } from 'arriendos360-contracts';

import { sequelize } from '../config/database';
import {
  claveUuid,
  columnasAuditoria,
  opcionesAuditoria,
  registrarHooksAuditoria,
} from './columnas';
import { CuentaCobro } from './CuentaCobro';
import { ESTADO_TRANSACCION_CONFIRMADA, TIPO_TRANSACCION_INGRESO } from './constantes';

/**
 * Tabla `Transacciones`: movimientos de dinero contra una cuenta de cobro. No se
 * borran: se anulan.
 */
export class Transaccion extends Model {
  declare id_transaccion: string;
  declare monto: number | string;
  declare fecha_pago: Date;
  declare tipo: string;
  declare medio_pago: string | null;
  declare estado: string;
  declare observaciones: string | null;
  declare saldo_restante_momento: number | string;
  declare id_cuenta_cobro: string;
  declare creado_por: string;
  declare actualizado_por: string;
  /** Lo rellena el `include`. Las dos tablas son de este servicio. */
  declare CuentaCobro?: CuentaCobro;
}

Transaccion.init(
  {
    id_transaccion: claveUuid(),

    monto: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

    /** Cuándo entró el dinero. */
    fecha_pago: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },

    /** Tipo de movimiento (`INGRESO`). No es el medio de pago. */
    tipo: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: TIPO_TRANSACCION_INGRESO,
      validate: {
        isIn: {
          args: [[...TIPOS_TRANSACCION]],
          msg: `El tipo de transacción debe ser uno de: ${TIPOS_TRANSACCION.join(', ')}`,
        },
      },
    },

    /** Cómo entró el dinero. Catálogo abierto. */
    medio_pago: { type: DataTypes.STRING(50) },

    /** `CONFIRMADA` o `ANULADA`. */
    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: ESTADO_TRANSACCION_CONFIRMADA,
      validate: {
        isIn: {
          args: [[...ESTADOS_TRANSACCION]],
          msg: `El estado de la transacción debe ser uno de: ${ESTADOS_TRANSACCION.join(', ')}`,
        },
      },
    },

    /** Referencia del movimiento, que imprime el comprobante. */
    observaciones: { type: DataTypes.TEXT },

    /**
     * Saldo que quedaba justo después de esta transacción: la foto del
     * comprobante. No se deriva ni se toca, ni al anular.
     */
    saldo_restante_momento: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

    id_cuenta_cobro: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: CuentaCobro, key: 'id_cuenta_cobro' },
    },
    ...columnasAuditoria,
  },
  {
    sequelize,
    modelName: 'Transaccion',
    tableName: 'transacciones',
    ...opcionesAuditoria,
  },
);

registrarHooksAuditoria(Transaccion);

Transaccion.belongsTo(CuentaCobro, { foreignKey: 'id_cuenta_cobro' });
CuentaCobro.hasMany(Transaccion, { foreignKey: 'id_cuenta_cobro' });
