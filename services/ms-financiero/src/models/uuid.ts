/** Reconocedor de UUID, para responder 404 y no 500 ante un identificador mal formado. */
const PATRON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (valor: unknown): valor is string =>
  typeof valor === 'string' && PATRON.test(valor);
