/**
 * Reconocedor de UUID.
 *
 * Existe porque `findByPk` con una cadena que no es UUID no devuelve `null`:
 * PostgreSQL rechaza el tipo y Sequelize lo propaga como error, que sale por el
 * `catch` como 500. Un identificador con forma invalida es un 404, no un fallo
 * del servidor.
 */
const PATRON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (valor: unknown): valor is string =>
  typeof valor === 'string' && PATRON.test(valor);
