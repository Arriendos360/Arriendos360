/**
 * Identificadores fijos del modelo de identidad.
 *
 * Estan replicados en `database/002_roles_base.sql`. Si cambias uno, cambia el
 * otro: no hay nada que los sincronice automaticamente.
 *
 * Los NOMBRES de rol no se declaran aqui: vienen de `packages/shared`, que es
 * quien los usa para leer los claims.
 */

import { ROL_INQUILINO, ROL_PROPIETARIO } from 'arriendos360-shared';

/** UUID de los roles del catalogo. */
export const ROLES: Record<string, string> = {
  PROPIETARIO: 'c84027dc-3334-4e4c-a4a8-73b88a7eaa23',
  INQUILINO: '29032002-315b-4bcf-8c1c-221616e9eb58',
};

/**
 * Autor de los cambios que no nacen de una peticion autenticada: las
 * migraciones y los procesos automaticos.
 *
 * Es un UUID que no existe en `usuarios` a proposito. Como las columnas de
 * auditoria no llevan clave foranea, puede apuntar a una identidad logica que no
 * es una persona.
 */
export const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';

/**
 * Precedencia para el `rol` singular de la respuesta del login.
 *
 * Los claims llevan el arreglo completo; el frontend necesita uno solo para
 * decidir que barra lateral pintar. Ante un usuario que es las dos cosas, manda
 * PROPIETARIO: es el rol con mas superficie, asi que la SPA arranca mostrando
 * todo lo que la persona puede hacer.
 */
export const PRECEDENCIA_ROLES: readonly string[] = [ROL_PROPIETARIO, ROL_INQUILINO];

/** Vigencia del token en segundos. El Capitulo 2 la fija en una hora. */
export const VIGENCIA_TOKEN_SEGUNDOS = 3600;

/** Esquema de autorizacion que el login declara y el middleware espera. */
export const TIPO_TOKEN = 'Bearer';

export { ROL_INQUILINO, ROL_PROPIETARIO };
