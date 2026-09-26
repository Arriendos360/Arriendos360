/** Cuerpo de todo error de la API. */
export interface ErrorRespuesta {
  mensaje: string;
}

/** Códigos de estado convenidos. */
export const ESTADO_VALIDACION = 400;
export const ESTADO_SIN_TOKEN = 401;
export const ESTADO_PROHIBIDO = 403;
export const ESTADO_NO_ENCONTRADO = 404;
export const ESTADO_PUERTA_ENLACE = 502;

/** Construye el cuerpo de error estandar. */
export function crearError(mensaje: string): ErrorRespuesta {
  return { mensaje };
}
