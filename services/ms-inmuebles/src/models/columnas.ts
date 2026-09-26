/**
 * Piezas de definicion que comparten los modelos: clave UUID y auditoria.
 */

import crypto from 'crypto';
import { DataTypes, type Model, type ModelStatic } from 'sequelize';

import { USUARIO_SISTEMA } from './constantes';

/** Clave primaria UUID generada en la aplicación, conocida antes del INSERT. */
export const claveUuid = () => ({
  type: DataTypes.UUID,
  primaryKey: true,
  defaultValue: (): string => crypto.randomUUID(),
});

/** Las dos columnas de autoria. Las fechas las pone `opcionesAuditoria`. */
export const columnasAuditoria = {
  creado_por: { type: DataTypes.UUID, allowNull: false },
  actualizado_por: { type: DataTypes.UUID, allowNull: false },
};

/** Opciones de `define()` con los nombres de fecha del modelo canonico. */
export const opcionesAuditoria = {
  timestamps: true,
  createdAt: 'fecha_creacion' as const,
  updatedAt: 'ultima_actualizacion' as const,
};

/** Opciones de escritura que aceptan un autor explicito. */
export interface OpcionesAuditables {
  usuarioAuditor?: string;
}

const autorDe = (opciones: unknown): string =>
  (opciones as OpcionesAuditables | undefined)?.usuarioAuditor ?? USUARIO_SISTEMA;

/**
 * Registra los hooks de autoría: el alta en `beforeValidate` (antes de validar
 * `allowNull`) y la modificación en `beforeUpdate`. No muevas la modificación a
 * `beforeValidate`: `instancia.update()` descartaría el cambio de `actualizado_por`.
 */
export const registrarHooksAuditoria = (modelo: ModelStatic<Model>): void => {
  modelo.addHook('beforeValidate', (instancia, opciones) => {
    const fila = instancia as Model & { creado_por?: string; actualizado_por?: string };

    if (!fila.isNewRecord) {
      return;
    }

    const autor = autorDe(opciones);
    if (!fila.getDataValue('creado_por')) {
      fila.setDataValue('creado_por', autor);
    }
    fila.setDataValue('actualizado_por', fila.getDataValue('creado_por'));
  });

  modelo.addHook('beforeUpdate', (instancia, opciones) => {
    (instancia as Model).set('actualizado_por', autorDe(opciones));
  });
};
