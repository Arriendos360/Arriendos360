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
 * Cuentas de cobro. Antes `Pago`, y antes del paso 6e vivia en el gateway.
 *
 * NO ES UN RENOMBRE. `pagos` mezclaba dos conceptos que el modelo canonico
 * separa: la FACTURA mensual que el sistema genera solo, que es esto, y el
 * MOVIMIENTO de dinero contra ella, que es `Transaccion`.
 *
 * ── NO HAY COLUMNA DE SALDO, Y ES DELIBERADO ────────────────────────────────
 *
 * `saldo_pendiente` existia y se actualizaba a mano en cada abono. Un dato
 * derivado que se guarda es un dato que puede mentir: bastaba un abono escrito
 * por otro camino —una correccion a mano en la base, un proceso futuro— para que
 * la columna y las transacciones dejaran de cuadrar, sin que nada lo delatara.
 *
 * El saldo se calcula: `valor` menos la suma de las transacciones CONFIRMADAS.
 * `services/saldos.ts` lo hace en una sola consulta para toda una lista y lo
 * adjunta como `saldo_pendiente`, asi que las respuestas de la API siguen
 * llevando el mismo campo con el mismo nombre. Lo que cambio es de donde sale.
 *
 * Consecuencia visible, y es la buena: anular una transaccion no tiene que
 * «devolver» nada. El saldo se corrige solo porque la suma deja de contarla.
 *
 * `id_contrato` es una referencia logica pura: cruza a ms-contratos y por eso no
 * lleva clave foranea (regla dura 1) ni asociacion de Sequelize. Lo que hace
 * falta de el se pide por HTTP (`clientes/contratos.ts`).
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

    /** Lo que se factura. Antes `monto_total`. */
    valor: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

    /**
     * El periodo que cubre la cuenta, explicito.
     *
     * Sustituye a `mes_correspondiente`, que era un solo instante y obligaba a
     * adivinar donde acababa el ciclo. `DATEONLY` porque son fechas de
     * calendario: un `TIMESTAMPTZ` leido con `.getDate()` las moveria un dia en
     * Bogota.
     *
     * La regla que las relaciona esta en `periodoDeCorte()`, en
     * `packages/shared`, y no se calcula en ningun otro sitio. Vive alli desde
     * el paso 6d, cuando Contratos y Financiero dejaron de compartir proceso:
     * duplicar la regla del dia 31 habria sido tener dos calendarios.
     */
    inicio: { type: DataTypes.DATEONLY, allowNull: false },
    fin: { type: DataTypes.DATEONLY, allowNull: false },

    /** Momento en que la cuenta quedo cubierta. Nulo mientras no lo este. */
    fecha_pago: { type: DataTypes.DATE },

    /**
     * Catalogo CERRADO, en `packages/contracts`. Sustituye a los enteros 1, 2, 4
     * y 3 —en ese orden— cuyo significado no estaba escrito en ninguna parte.
     *
     * `EN_MORA` es un estado de vencimiento, no de pago, y por eso gana sobre
     * `PARCIAL`: una cuenta abonada a medias que paso el sexto dia sigue en
     * mora. De ahi solo se sale pagandola entera. Ver `services/saldos.ts`.
     */
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
