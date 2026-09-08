/**
 * Punto único de importación de los modelos del gateway.
 *
 * Ya no hay modelos de identidad: `Usuario`, `Rol`, `RolUsuario` y
 * `TokenRevocado` se fueron con ms-identidad. Donde antes se hacía
 * `include: [{ model: Usuario, as: 'Inquilino' }]`, ahora el gateway pide los
 * datos por HTTP y compone la respuesta (`clientes/identidad.js`).
 */

const Abono = require('./Abono');
const Anexo = require('./Anexo');
const Contrato = require('./Contrato');
const Pago = require('./Pago');

module.exports = { Abono, Anexo, Contrato, Pago };
