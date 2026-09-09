/**
 * Constantes que el gateway todavía necesita.
 *
 * ── YA NO VIVE EN `models/`, PORQUE YA NO HAY MODELOS ───────────────────────
 *
 * No queda ninguno, y por eso la carpeta desapareció con el paso 6e. `Usuario`, `Rol` y `TokenRevocado` se fueron con
 * ms-identidad; `Inmueble` con ms-inmuebles; `Contrato` y `Anexo` con
 * ms-contratos; y `CuentaCobro` y `Transaccion` con ms-financiero en el paso 6e.
 * Con ellos se fueron `auditoria.js`, `uuid.js`, `config/database.js` y el
 * aplicador de migraciones: **el gateway no tiene tablas ni conexión a base**.
 *
 * Lo que queda aquí son NOMBRES para valores que el gateway lee de respuestas
 * ajenas. El dashboard filtra contratos por `estado` y cuentas de cobro por el
 * suyo, y sin estas constantes repartiría literales sueltos por el código — que
 * es exactamente lo que pasaba con los enteros 1, 2, 3 y 4 antes del paso 6c.
 *
 * Los catálogos CERRADOS no se declaran aquí: viven en `packages/contracts`,
 * porque los comparten el servicio dueño, el frontend y el `CHECK` de su
 * migración. Aquí sólo se les pone nombre a los que el gateway mira.
 *
 * Los nombres de rol vienen de `packages/shared`, que es quien los usa para leer
 * los claims.
 */

const { ROL_INQUILINO, ROL_PROPIETARIO } = require('arriendos360-shared');

/**
 * Estados de un contrato. Los escribe ms-contratos; el dashboard los cuenta y el
 * guardia de borrado pregunta por el primero.
 */
const ESTADO_CONTRATO_ACTIVO = 'activo';
const ESTADO_CONTRATO_FINALIZADO = 'finalizado';
const ESTADO_CONTRATO_CANCELADO = 'cancelado';

/**
 * Estados de una cuenta de cobro. Los escribe ms-financiero; el dashboard los
 * usa para pedirle sólo las que le interesan a cada métrica.
 *
 * OJO al orden en que traducían los enteros viejos: 4 era PARCIAL y 3 era
 * EN_MORA, no al revés.
 */
const ESTADO_CUENTA_PENDIENTE = 'PENDIENTE';
const ESTADO_CUENTA_PAGADA = 'PAGADA';
const ESTADO_CUENTA_PARCIAL = 'PARCIAL';
const ESTADO_CUENTA_EN_MORA = 'EN_MORA';

/**
 * Autor de los cambios que no origina una persona.
 *
 * El gateway ya no escribe nada, así que no lo usa para auditar: lo conserva
 * porque es el UUID con el que los servicios firman lo que hace el sistema, y
 * las pruebas lo comprueban al leer respuestas ajenas. Es el mismo en los cuatro
 * servicios a propósito: identifica al sistema, no al servicio.
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
    ROL_INQUILINO,
    ROL_PROPIETARIO,
    USUARIO_SISTEMA
};
