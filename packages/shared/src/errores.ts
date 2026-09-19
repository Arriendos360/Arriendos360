/**
 * Forma estandar de error del proyecto.
 *
 * Convencion de `CLAUDE.md`: el cuerpo de todo error es `{ mensaje: "..." }`,
 * nunca `{ error }` ni `{ message }`. El monolito ya lo hace asi y los servicios
 * extraidos deben mantenerlo, porque el frontend y la coleccion de Postman leen
 * ese campo.
 */
export interface ErrorRespuesta {
  mensaje: string;
}

/**
 * Codigos de estado que el proyecto usa de forma convenida.
 *
 * - `400` validacion
 * - `401` falta el token
 * - `403` token invalido o expirado, o rol insuficiente
 * - `404` no encontrado
 * - `502` el gateway no pudo alcanzar al servicio de destino
 */
export const ESTADO_VALIDACION = 400;
export const ESTADO_SIN_TOKEN = 401;
export const ESTADO_PROHIBIDO = 403;
export const ESTADO_NO_ENCONTRADO = 404;
export const ESTADO_PUERTA_ENLACE = 502;

/** Construye el cuerpo de error estandar. */
export function crearError(mensaje: string): ErrorRespuesta {
  return { mensaje };
}
