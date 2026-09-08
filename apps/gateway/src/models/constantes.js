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
 * Estados de una cuenta de cobro y de una transacción.
 *
 * Mismo trato que los del contrato y por el mismo motivo: el catálogo cerrado
 * vive en `packages/contracts` porque lo comparten el modelo, el frontend y el
 * `CHECK` de la migración, y aquí sólo se les pone nombre para que los `where`
 * del motor, del controlador y del dashboard no repartan literales sueltos —que
 * es lo que pasaba con los enteros 1, 2, 3 y 4 que esto sustituye.
 *
 * OJO al orden en que traducían: 4 era PARCIAL y 3 era EN_MORA, no al revés.
 */
const ESTADO_CUENTA_PENDIENTE = 'PENDIENTE';
const ESTADO_CUENTA_PAGADA = 'PAGADA';
const ESTADO_CUENTA_PARCIAL = 'PARCIAL';
const ESTADO_CUENTA_EN_MORA = 'EN_MORA';

const ESTADO_TRANSACCION_CONFIRMADA = 'CONFIRMADA';
const ESTADO_TRANSACCION_ANULADA = 'ANULADA';

/** Hoy todo movimiento del sistema es dinero que entra. */
const TIPO_TRANSACCION_INGRESO = 'INGRESO';

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
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PAGADA,
    ESTADO_CUENTA_PARCIAL,
    ESTADO_CUENTA_PENDIENTE,
    ESTADO_TRANSACCION_ANULADA,
    ESTADO_TRANSACCION_CONFIRMADA,
    ROL_INQUILINO,
    ROL_PROPIETARIO,
    TIPO_TRANSACCION_INGRESO,
    USUARIO_SISTEMA
};
