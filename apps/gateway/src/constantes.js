/** Nombres para los valores que el gateway lee de respuestas de otros servicios. */

const { ROL_INQUILINO, ROL_PROPIETARIO } = require('arriendos360-shared');

/** Estados de un contrato. */
const ESTADO_CONTRATO_ACTIVO = 'activo';
const ESTADO_CONTRATO_FINALIZADO = 'finalizado';
const ESTADO_CONTRATO_CANCELADO = 'cancelado';

/** Estados de una cuenta de cobro. */
const ESTADO_CUENTA_PENDIENTE = 'PENDIENTE';
const ESTADO_CUENTA_PAGADA = 'PAGADA';
const ESTADO_CUENTA_PARCIAL = 'PARCIAL';
const ESTADO_CUENTA_EN_MORA = 'EN_MORA';

/** UUID con el que los servicios auditan lo que hace el sistema. */
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
