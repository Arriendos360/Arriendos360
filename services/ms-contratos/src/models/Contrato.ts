import { DataTypes, Model } from 'sequelize';
import { ESTADOS_CONTRATO } from 'arriendos360-contracts';
import { diaLimiteDesde, fechaInicioCorteDesde } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';
import { ESTADO_CONTRATO_ACTIVO } from './constantes';

/**
 * Tabla `Contratos`. `id_inmueble` e `id_inquilino` son referencias sin clave
 * foránea. No lleva `id_propietario`: la pertenencia se pregunta a ms-inmuebles.
 */
export class Contrato extends Model {
  declare id_contrato: string;
  declare inicio: Date | string;
  declare fin: Date | string;
  declare canon: number | string;
  declare fecha_inicio_corte: string;
  declare fecha_limite_pago: number;
  declare info_contrato: string | null;
  declare estado: string;
  declare nombre_deudor_solidario: string | null;
  declare documento_deudor_solidario: string | null;
  declare id_inmueble: string;
  declare id_inquilino: string;
  declare creado_por: string;
  declare actualizado_por: string;
}

Contrato.init(
  {
    id_contrato: claveUuid(),
    inicio: { type: DataTypes.DATE, allowNull: false },
    fin: { type: DataTypes.DATE, allowNull: false },
    canon: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

    /** Primera fecha de corte. `DATEONLY`: se lee como `YYYY-MM-DD`, sin zona horaria. */
    fecha_inicio_corte: { type: DataTypes.DATEONLY, allowNull: false },

    /** Día del mes en que vence el pago, tal como se pactó. */
    fecha_limite_pago: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: { args: [1], msg: 'La fecha límite de pago debe ser un día del mes (1-31)' },
        max: { args: [31], msg: 'La fecha límite de pago debe ser un día del mes (1-31)' },
      },
    },

    /** Condiciones particulares en texto libre. Opcional. */
    info_contrato: { type: DataTypes.TEXT, allowNull: true },

    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: ESTADO_CONTRATO_ACTIVO,
      validate: {
        isIn: {
          args: [[...ESTADOS_CONTRATO]],
          msg: `El estado del contrato debe ser uno de: ${ESTADOS_CONTRATO.join(', ')}`,
        },
      },
    },

    /** Deudor solidario, opcional. */
    nombre_deudor_solidario: { type: DataTypes.STRING(150), allowNull: true },
    documento_deudor_solidario: { type: DataTypes.STRING(20), allowNull: true },

    id_inmueble: { type: DataTypes.UUID, allowNull: false },
    id_inquilino: { type: DataTypes.UUID, allowNull: false },
    ...columnasAuditoria,
  },
  {
    sequelize,
    modelName: 'Contrato',
    tableName: 'contratos',
    ...opcionesAuditoria,
  },
);

registrarHooksAuditoria(Contrato);

/**
 * Al crear, deriva `fecha_inicio_corte` y `fecha_limite_pago` de `inicio` si no
 * vienen dadas. Va en `beforeValidate` porque las dos son `allowNull: false`.
 */
Contrato.addHook('beforeValidate', (instancia) => {
  const contrato = instancia as Contrato;

  if (!contrato.isNewRecord || !contrato.getDataValue('inicio')) {
    return;
  }

  const inicio = contrato.getDataValue('inicio');

  if (!contrato.getDataValue('fecha_inicio_corte')) {
    const derivada = fechaInicioCorteDesde(inicio);
    if (derivada !== null) {
      contrato.setDataValue('fecha_inicio_corte', derivada);
    }
  }

  const limite = contrato.getDataValue('fecha_limite_pago');
  if (limite === null || limite === undefined) {
    const derivado = diaLimiteDesde(inicio);
    if (derivado !== null) {
      contrato.setDataValue('fecha_limite_pago', derivado);
    }
  }
});
