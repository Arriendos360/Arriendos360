/**
 * Piezas de definicion que comparten los modelos: clave UUID y auditoria.
 */

import crypto from 'crypto';
import { DataTypes, type Model, type ModelStatic } from 'sequelize';

import { USUARIO_SISTEMA } from './constantes';

/**
 * Clave primaria UUID generada en la aplicacion.
 *
 * No es un `DEFAULT` de PostgreSQL a proposito: un servicio necesita conocer el
 * identificador ANTES de que la fila exista, para poder publicarlo en el evento
 * que dispara la creacion en cadena. Sequelize evalua este `defaultValue` al
 * construir la instancia, asi que el id esta disponible antes del INSERT.
 */
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
 * Registra los hooks de autoria.
 *
 * Van en `beforeValidate` y no en `beforeCreate` por el orden de Sequelize:
 * `beforeValidate` -> validacion -> `beforeCreate`. Como las dos columnas son
 * `allowNull: false`, rellenarlas en `beforeCreate` llega tarde.
 */
export const registrarHooksAuditoria = (modelo: ModelStatic<Model>): void => {
  modelo.addHook('beforeValidate', (instancia, opciones) => {
    const autor = autorDe(opciones);
    const fila = instancia as Model & { creado_por?: string; actualizado_por?: string };

    if (fila.isNewRecord) {
      // Un `creado_por` explicito gana: el autorregistro lo necesita, porque
      // ahi el autor es el propio usuario que se esta creando.
      if (!fila.getDataValue('creado_por')) {
        fila.setDataValue('creado_por', autor);
      }
      fila.setDataValue('actualizado_por', fila.getDataValue('creado_por'));
      return;
    }

    fila.setDataValue('actualizado_por', autor);
  });
};
