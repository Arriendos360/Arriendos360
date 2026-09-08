/**
 * Punto único de importación de los modelos del gateway.
 *
 * Ya no hay modelos de identidad: `Usuario`, `Rol`, `RolUsuario` y
 * `TokenRevocado` se fueron con ms-identidad. Donde antes se hacía
 * `include: [{ model: Usuario, as: 'Inquilino' }]`, ahora el gateway pide los
 * datos por HTTP y compone la respuesta (`clientes/identidad.js`).
 *
 * `Pago` y `Abono` tampoco están, pero por otro motivo: no se fueron, se
 * partieron. El paso 6c los convirtió en `CuentaCobro` y `Transaccion`, que son
 * los dos conceptos que aquellos mezclaban. Ver la cabecera de `CuentaCobro.js`.
 */

const Anexo = require('./Anexo');
const Contrato = require('./Contrato');
const CuentaCobro = require('./CuentaCobro');
const Transaccion = require('./Transaccion');

module.exports = { Anexo, Contrato, CuentaCobro, Transaccion };
