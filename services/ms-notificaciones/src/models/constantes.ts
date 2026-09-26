/**
 * Catálogos de MS-Notificaciones. Los estados están también en el `CHECK` de
 * `database/notificaciones/001`: si agregas uno, toca los dos.
 */

/** Redactado y a la espera del enviador. */
export const ENVIO_PENDIENTE = 'pendiente';

/**
 * Tomado por el enviador. Una fila que se queda aquí no se reintenta sola: no se
 * sabe si el correo salió.
 */
export const ENVIO_ENVIANDO = 'enviando';

/** Aceptado por el servidor de correo. Terminal. */
export const ENVIO_ENVIADO = 'enviado';

/** Agoto los intentos. Deja de intentarse y queda a la vista. Terminal. */
export const ENVIO_APARTADO = 'apartado';

/*
 * Un fallo conocido devuelve la fila a `pendiente` con `intentos`, `ultimo_error`
 * y `proximo_intento_en` actualizados; no hay estado `fallido`.
 */

export const ESTADOS_ENVIO = [
  ENVIO_PENDIENTE,
  ENVIO_ENVIANDO,
  ENVIO_ENVIADO,
  ENVIO_APARTADO,
] as const;

/** Canal de entrega. Catálogo abierto. */
export const CANAL_EMAIL = 'EMAIL';
