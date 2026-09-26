/** Reconocedor de UUID, para descartar identificadores de ruta mal formados. */

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Es esto un UUID? */
const esUuid = (valor) => typeof valor === 'string' && PATRON_UUID.test(valor);

module.exports = { esUuid };
