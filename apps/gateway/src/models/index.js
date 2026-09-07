/**
 * Punto único de importación de los modelos.
 *
 * `Propietario` e `Inquilino` desaparecieron: la distinción vive ahora en
 * `RolUsuario`. Donde antes se hacía `include: [{ model: Propietario }]`, ahora
 * va `include: [{ model: Usuario, as: 'Propietario' }]` — el alias sobrevive,
 * la tabla no.
 */

const Abono = require('./Abono');
const Contrato = require('./Contrato');
const Inmueble = require('./Inmueble');
const Pago = require('./Pago');
const Rol = require('./Rol');
const RolUsuario = require('./RolUsuario');
const TokenRevocado = require('./TokenRevocado');
const Usuario = require('./Usuario');

module.exports = {
    Abono,
    Contrato,
    Inmueble,
    Pago,
    Rol,
    RolUsuario,
    TokenRevocado,
    Usuario
};
