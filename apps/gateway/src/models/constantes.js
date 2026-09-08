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
 * Estados de un contrato.
 *
 * El catálogo cerrado vive en `packages/contracts` porque lo comparten el
 * modelo, el frontend y el `CHECK` de la migración. Aquí sólo se les pone
 * nombre, para que los `where` del motor financiero, del dashboard y del
 * guardia de borrado no repartan literales sueltos por el código — que es
 * exactamente lo que pasaba con los enteros 1 y 2 que esto sustituye.
 */
const ESTADO_CONTRATO_ACTIVO = 'activo';
const ESTADO_CONTRATO_FINALIZADO = 'finalizado';
const ESTADO_CONTRATO_CANCELADO = 'cancelado';

/**
 * Autor de los cambios que no origina una persona: el motor financiero cuando
 * genera recibos a medianoche.
 *
 * Es un UUID que no corresponde a ningún usuario a propósito. Como las columnas
 * de auditoría no llevan clave foránea —y ahora ni siquiera podrían, porque
 * `usuarios` está en otro esquema— puede apuntar a una identidad lógica.
 */
const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';

module.exports = {
    ESTADO_CONTRATO_ACTIVO,
    ESTADO_CONTRATO_CANCELADO,
    ESTADO_CONTRATO_FINALIZADO,
    ROL_INQUILINO,
    ROL_PROPIETARIO,
    USUARIO_SISTEMA
};
