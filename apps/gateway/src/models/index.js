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
 *
 * Y desde el paso 6d tampoco están `Contrato` ni `Anexo`: se fueron con
 * ms-contratos, con sus tablas, sus rutas y su bandeja de eventos. Lo que el
 * gateway necesita de un contrato —de quién es, cuál es su inmueble, quién lo
 * arrienda— lo pide por HTTP (`clientes/contratos.js`).
 *
 * Quedan las DOS de Financiero, que se van en el paso 6e. Cuando se vayan, este
 * archivo desaparece: el gateway se queda sin tablas propias, que es lo que el
 * Capítulo 2 dice que tiene que ser.
 */

const CuentaCobro = require('./CuentaCobro');
const Transaccion = require('./Transaccion');

module.exports = { CuentaCobro, Transaccion };
