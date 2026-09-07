/**
 * Constantes que el gateway todavía necesita.
 *
 * Los UUID de los roles y la vigencia del token se fueron con ms-identidad: es
 * él quien crea filas en `RolesUsuario` y quien firma. Aquí sólo queda el autor
 * de los cambios que no nacen de una petición autenticada.
 *
 * Los nombres de rol vienen de `packages/shared`, que es quien los usa para leer
 * los claims.
 */

const { ROL_INQUILINO, ROL_PROPIETARIO } = require('arriendos360-shared');

/**
 * Autor de los cambios que no origina una persona: el motor financiero cuando
 * genera recibos a medianoche.
 *
 * Es un UUID que no corresponde a ningún usuario a propósito. Como las columnas
 * de auditoría no llevan clave foránea —y ahora ni siquiera podrían, porque
 * `usuarios` está en otro esquema— puede apuntar a una identidad lógica.
 */
const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';

module.exports = { ROL_INQUILINO, ROL_PROPIETARIO, USUARIO_SISTEMA };
