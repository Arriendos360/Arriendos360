/** Reconocedor de UUID, para validar los identificadores de las cargas. */
const PATRON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (valor: unknown): valor is string =>
  typeof valor === 'string' && PATRON.test(valor);
