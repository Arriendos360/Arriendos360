/**
 * Columna de clave primaria UUID.
 *
 * El valor lo genera `crypto.randomUUID()` en la aplicación, no un DEFAULT de
 * PostgreSQL. La razón está en el Capítulo 2: un servicio tiene que conocer el
 * identificador ANTES de que la fila exista, para poder publicarlo en el evento
 * que dispara la creación en cadena. Sequelize evalúa este `defaultValue` al
 * construir la instancia, así que `nuevo.id_x` ya está disponible antes del
 * INSERT.
 */

const crypto = require('crypto');
const { DataTypes } = require('sequelize');

const claveUuid = () => ({
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: () => crypto.randomUUID()
});

/** Referencia lógica a otro agregado: UUID obligatorio y SIN clave foránea. */
const referenciaUuid = ({ allowNull = false } = {}) => ({
    type: DataTypes.UUID,
    allowNull
});

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Es esto un UUID?
 *
 * Hace falta porque PostgreSQL rechaza con error de tipo cualquier cosa que no
 * lo sea, y Sequelize lo propaga como un 500. Antes de este paso los
 * identificadores eran enteros y una cédula colaba sin romper; ahora un
 * `id_inquilino` con la cédula vieja tiene que responder 404, no 500.
 */
const esUuid = (valor) => typeof valor === 'string' && PATRON_UUID.test(valor);

module.exports = { claveUuid, esUuid, referenciaUuid };
