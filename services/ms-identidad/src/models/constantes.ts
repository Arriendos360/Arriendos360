/**
 * Identificadores fijos del modelo de identidad. Los UUID de rol están también en
 * `database/identidad/002_roles_base.sql`: si cambias uno, cambia el otro.
 */

import { ROL_INQUILINO, ROL_PROPIETARIO } from 'arriendos360-shared';

/** UUID de los roles del catalogo. */
export const ROLES: Record<string, string> = {
  PROPIETARIO: 'c84027dc-3334-4e4c-a4a8-73b88a7eaa23',
  INQUILINO: '29032002-315b-4bcf-8c1c-221616e9eb58',
};

/** Autor de los cambios que no hace una persona. No existe en `usuarios`. */
export const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';

/** Precedencia para el `rol` singular del login: gana PROPIETARIO. */
export const PRECEDENCIA_ROLES: readonly string[] = [ROL_PROPIETARIO, ROL_INQUILINO];

/** Vigencia del token en segundos. */
export const VIGENCIA_TOKEN_SEGUNDOS = 3600;

/** Esquema de autorizacion que el login declara y el middleware espera. */
export const TIPO_TOKEN = 'Bearer';

export { ROL_INQUILINO, ROL_PROPIETARIO };
