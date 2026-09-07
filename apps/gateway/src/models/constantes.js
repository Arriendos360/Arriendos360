/**
 * Identificadores fijos del modelo de identidad.
 *
 * Están replicados en `database/identidad/002_roles_base.sql`. Si cambias uno,
 * cambia el otro: no hay nada que los sincronice automáticamente.
 *
 * Los NOMBRES de rol no se declaran aquí: vienen de `packages/shared`, que es
 * quien los usa para leer los claims. Definirlos en los dos sitios era pedir que
 * se desincronizaran.
 */

const { ROL_INQUILINO, ROL_PROPIETARIO } = require('arriendos360-shared');

/** UUID de los roles del catálogo. Los nombres van en mayúsculas, como los claims. */
const ROLES = {
    PROPIETARIO: 'c84027dc-3334-4e4c-a4a8-73b88a7eaa23',
    INQUILINO: '29032002-315b-4bcf-8c1c-221616e9eb58'
};

/**
 * Autor de los cambios que no nacen de una petición autenticada: el motor
 * financiero cuando genera recibos a medianoche, y las migraciones.
 *
 * Es un UUID que no existe en `usuarios` a propósito. Como las columnas de
 * auditoría no llevan clave foránea, puede apuntar a una identidad lógica que no
 * es una persona.
 */
const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';

/**
 * Precedencia para el `rol` singular de la respuesta del login.
 *
 * Los claims llevan el arreglo completo; el frontend necesita uno solo para
 * decidir qué barra lateral pintar. Ante un usuario que es las dos cosas, manda
 * PROPIETARIO: es el rol con más superficie de aplicación, así que la SPA
 * arranca mostrando todo lo que la persona puede hacer.
 */
const PRECEDENCIA_ROLES = [ROL_PROPIETARIO, ROL_INQUILINO];

/** Vigencia del token en segundos. El Capítulo 2 la fija en una hora. */
const VIGENCIA_TOKEN_SEGUNDOS = 3600;

/** Esquema de autorización que el login declara y el middleware espera. */
const TIPO_TOKEN = 'Bearer';

module.exports = {
    PRECEDENCIA_ROLES,
    ROLES,
    ROL_INQUILINO,
    ROL_PROPIETARIO,
    TIPO_TOKEN,
    USUARIO_SISTEMA,
    VIGENCIA_TOKEN_SEGUNDOS
};
