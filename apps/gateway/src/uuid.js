/**
 * Reconocedor de UUID.
 *
 * ── LO QUE QUEDA DE `models/uuid.js` ────────────────────────────────────────
 *
 * Aquel archivo tenía tres cosas: `claveUuid()` y `referenciaUuid()`, que
 * definían columnas de Sequelize, y esto. Las dos primeras se fueron en el paso
 * 6e con las dos últimas tablas del gateway; ésta se queda porque no tiene nada
 * que ver con la persistencia — es una comprobación de forma sobre un segmento
 * de la URL.
 *
 * ── PARA QUÉ SIRVE AHORA ────────────────────────────────────────────────────
 *
 * Un solo consumidor: el guardia de borrado, que saca el `:id` de la ruta y le
 * pregunta a ms-contratos si ese inmueble tiene contratos activos. Si el
 * identificador no tiene forma de UUID no hace falta preguntar nada: no puede
 * existir, y el guardia deja pasar la petición para que ms-inmuebles responda su
 * 404.
 *
 * Antes esto además evitaba un 500: PostgreSQL rechaza con error de tipo
 * cualquier cosa que no sea UUID, y Sequelize lo propagaba. El gateway ya no
 * consulta ninguna base, así que ese motivo desapareció; el otro —no gastar un
 * salto de red en algo que no puede existir— sigue en pie.
 */

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Es esto un UUID? */
const esUuid = (valor) => typeof valor === 'string' && PATRON_UUID.test(valor);

module.exports = { esUuid };
