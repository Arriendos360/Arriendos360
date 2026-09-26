import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { CANAL_EMAIL, ENVIO_PENDIENTE, ESTADOS_ENVIO } from './constantes';

/**
 * Bitácora de envíos (outbox de correos): un correo por fila, desde que se
 * redacta hasta que sale. La escribe el consumidor en la transacción del evento y
 * la vacía `services/enviador.ts`. Tabla operativa, sin auditoría.
 */
export class Envio extends Model {
  declare id_envio: string;
  declare id_evento: string;
  declare tipo_evento: string;
  declare id_usuario: string;
  declare destinatario: string;
  declare canal: string;
  declare asunto: string;
  declare cuerpo: string | null;
  declare estado: string;
  declare intentos: number;
  declare proximo_intento_en: Date;
  declare ultimo_error: string | null;
  declare enviado_en: Date | null;
  declare registrado_en: Date;
}

Envio.init(
  {
    id_envio: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },

    /** El evento que lo provocó. Un evento puede producir varios envíos. */
    id_evento: { type: DataTypes.UUID, allowNull: false },
    tipo_evento: { type: DataTypes.STRING(80), allowNull: false },

    /** A quién se quiso avisar (`id_usuario`) y a qué dirección salió (`destinatario`). */
    id_usuario: { type: DataTypes.UUID, allowNull: false },
    destinatario: { type: DataTypes.STRING(255), allowNull: false },

    canal: { type: DataTypes.STRING(20), allowNull: false, defaultValue: CANAL_EMAIL },

    asunto: { type: DataTypes.STRING(255), allowNull: false },

    /**
     * El cuerpo ya redactado. Se borra en la misma sentencia que marca la fila
     * como enviada: puede llevar el token de recuperación.
     */
    cuerpo: { type: DataTypes.TEXT },

    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: ENVIO_PENDIENTE,
      validate: { isIn: [[...ESTADOS_ENVIO]] },
    },

    intentos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    proximo_intento_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    ultimo_error: { type: DataTypes.TEXT },
    enviado_en: { type: DataTypes.DATE },
    registrado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'Envio',
    tableName: 'envios',
    // Sus marcas de tiempo son `registrado_en` y `enviado_en`.
    timestamps: false,
  },
);
