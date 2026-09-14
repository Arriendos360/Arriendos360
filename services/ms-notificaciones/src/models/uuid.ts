/**
 * Reconocedor de UUID.
 *
 * En los otros servicios existe porque `findByPk` con una cadena que no es UUID
 * no devuelve `null`: PostgreSQL rechaza el tipo y el error sale como 500 donde
 * tocaba un 404.
 *
 * Aqui el motivo es otro, porque este servicio no tiene endpoints publicos ni
 * busca nada por identificador. Lo usa la validacion de las cargas de los eventos:
 * un `id_usuario` con forma invalida tiene que hacer fallar el manejador ANTES de
 * preguntarle a ms-identidad, para que el error diga «el emisor mando un sobre
 * roto» en vez de «ms-identidad no encontro al usuario». Los dos acabarian en un
 * reintento, pero solo uno de los dos mensajes dice donde esta el problema.
 */
const PATRON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (valor: unknown): valor is string =>
  typeof valor === 'string' && PATRON.test(valor);
