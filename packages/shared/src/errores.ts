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

/**
 * Comprueba en runtime que un valor desconocido tenga la forma
 * `{ mensaje: string }`.
 *
 * Util al leer la respuesta de otro servicio: lo que llega por la red es
 * `unknown` hasta que se verifica.
 */
export function esErrorRespuesta(valor: unknown): valor is ErrorRespuesta {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'mensaje' in valor &&
    typeof (valor as { mensaje: unknown }).mensaje === 'string'
  );
}

/**
 * Error con codigo de estado HTTP asociado.
 *
 * Permite que una capa profunda lance el error y que el handler de Express lo
 * traduzca a `res.status(error.estado).json(error.aRespuesta())` sin inventarse
 * el codigo.
 */
export class ErrorHttp extends Error {
  public readonly estado: number;

  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorHttp';
    this.estado = estado;
    // Necesario para que `instanceof` funcione al compilar a ES5/ES2015+
    // extendiendo un builtin.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Cuerpo listo para enviar al cliente. */
  public aRespuesta(): ErrorRespuesta {
    return { mensaje: this.message };
  }
}
