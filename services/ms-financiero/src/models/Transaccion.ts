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
 * Transacciones. Antes `Abono`, y antes del paso 6e vivia en el gateway.
 *
 * El movimiento de dinero contra una cuenta de cobro. A diferencia de las demas
 * referencias del proyecto, esta SI conserva clave foranea: `transacciones` y
 * `cuentas_cobro` son las dos tablas de este servicio, asi que no cruza frontera
 * y la regla dura 1 no la toca.
 *
 * ── EL CAMPO QUE NO SE LLAMA COMO PARECE ────────────────────────────────────
 *
 * `tipo_transaccion` no se convirtio en `tipo`. Guardaba "Transferencia
 * Bancaria", "Efectivo" y "Consignacion", que son MEDIOS de pago; su destino es
 * `medio_pago`. `tipo` es el tipo de MOVIMIENTO —hoy siempre `INGRESO`— y es un
 * campo nuevo. Traducirlo por el parecido del nombre habria puesto "Efectivo" en
 * `tipo` y solo se habria notado al imprimir «Forma de pago: INGRESO» en un
 * comprobante.
 *
 * ── UNA TRANSACCION NO SE BORRA: SE ANULA ───────────────────────────────────
 *
 * `estado` es lo que permite corregir un registro equivocado sin falsificar el
 * historial. Anular cambia el estado y nada mas: el saldo se corrige solo porque
 * la suma que lo deriva ignora las anuladas. El comprobante que ya se emitio
 * sigue existiendo y sigue diciendo lo que decia. Ver `docs/adr/0016`.
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

    /** Cuando entro el dinero. Antes `fecha_abono`. */
    fecha_pago: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },

    /** Catalogo CERRADO con un solo valor. Ver `packages/contracts`. */
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

    /**
     * Como entro el dinero. Antes `tipo_transaccion`.
     *
     * Catalogo ABIERTO, el unico de los cuatro de Financiero: el Capitulo 2
     * ejemplifica `TRANSFERENCIA` sin cerrar la lista, y la columna ya guarda el
     * texto libre del desplegable de la SPA. Sin `isIn` y sin `CHECK`.
     */
    medio_pago: { type: DataTypes.STRING(50) },

    /** Catalogo CERRADO. Anular no borra. */
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

    /**
     * Referencia del movimiento, en texto libre.
     *
     * NO esta en el modelo canonico y se conserva a proposito: es lo que el
     * comprobante imprime en «Referencia trans.», y sin ella ese renglon pasaria
     * a mostrar un UUID generado por el sistema en lugar del numero de
     * consignacion que el arrendatario tiene en su extracto. Ver
     * `docs/adr/0015`.
     */
    observaciones: { type: DataTypes.TEXT },

    /**
     * Lo que quedaba por pagar justo despues de esta transaccion.
     *
     * ESTO NO SE DERIVA, y es la excepcion deliberada a que el saldo se calcule.
     * No es el saldo actual de la cuenta: es una FOTO del saldo en el instante
     * en que se emitio el comprobante, y ese comprobante ya esta impreso en casa
     * de alguien. Recalcularla cambiaria un documento entregado.
     *
     * De ahi que anular una transaccion posterior no toque esta columna en las
     * anteriores: el saldo vigente cambia, el historico no.
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
