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
 * SON TRES HOOKS Y NO UNO, y la razon es una trampa de Sequelize que conviene
 * dejar escrita.
 *
 * `beforeValidate` cubre el ALTA. Tiene que ser ahi y no en `beforeCreate` por
 * el orden de ejecucion —`beforeValidate` -> validacion -> `beforeCreate`— y
 * porque las dos columnas son `allowNull: false`: rellenarlas despues de la
 * validacion llega tarde.
 *
 * `beforeBulkUpdate` cubre la ACTUALIZACION MASIVA. `Modelo.update(...)` con un
 * `where` no instancia el modelo y se saltaria los otros dos. Hoy no lo usa
 * ningun controlador de este servicio; se conserva porque cuesta nada y porque
 * el dia que alguien escriba `CuentaCobro.update({...}, { where })` la columna
 * tiene que salir correcta sin que haya que acordarse de esto.
 *
 * `beforeUpdate` cubre la MODIFICACION de una instancia, y no vale hacerlo
 * tambien en `beforeValidate`. `instancia.update(valores)` decide que columnas escribe a
 * partir de las claves de `valores`, antes de disparar ningun hook; despues
 * recupera lo que hayan cambiado los hooks de guardado —`beforeUpdate`— pero
 * descarta expresamente lo que ya estuviera marcado como cambiado antes de
 * empezar, que es justo el caso si se hubiera tocado en `beforeValidate`. El
 * sintoma era mudo: `actualizado_por` conservaba para siempre el valor del alta,
 * y no lo delataba ninguna prueba porque casi siempre quien crea y quien
 * modifica son la misma persona. Se ve al primer cambio que hace el SISTEMA y no
 * una persona, que es lo que trajo el bus de eventos.
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

  modelo.addHook('beforeBulkUpdate', (opciones) => {
    const masiva = opciones as {
      attributes?: Record<string, unknown>;
      fields?: string[];
    };

    masiva.attributes = { ...masiva.attributes, actualizado_por: autorDe(opciones) };

    // Sin esto Sequelize ignora el atributo que acabamos de añadir, porque
    // `fields` ya venia calculado a partir de los valores originales. Es la
    // misma trampa que la de `beforeUpdate`, en la version masiva.
    if (Array.isArray(masiva.fields) && !masiva.fields.includes('actualizado_por')) {
      masiva.fields = [...masiva.fields, 'actualizado_por'];
    }
  });
};
