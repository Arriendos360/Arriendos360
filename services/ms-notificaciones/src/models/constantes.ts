/**
 * Catalogos de MS-Notificaciones.
 *
 * ── POR QUE NO ESTAN EN `packages/contracts` ────────────────────────────────
 *
 * Porque nadie fuera de este servicio los ve. `packages/contracts` existe para lo
 * que COMPARTEN el servicio, el frontend y el `CHECK` de una migracion —el `tipo`
 * de un inmueble, el `estado` de una cuenta de cobro— y estos estados no los
 * comparte nadie: este servicio no tiene endpoints publicos, asi que no hay
 * frontend que los muestre ni respuesta que los lleve.
 *
 * Lo que si los comparte es el `CHECK` de `database/notificaciones/001`, y eso
 * pide tocar dos sitios si se agrega un valor. Igual que con los catalogos
 * cerrados de Inmuebles: nada los sincroniza.
 *
 * ── Y POR QUE VAN EN MINUSCULAS ─────────────────────────────────────────────
 *
 * Los de Financiero van en MAYUSCULAS porque el Capitulo 2 fija
 * `"tipo": "INGRESO"` en el cuerpo de `POST /api/pagos`, que es un contrato de
 * interfaz. Aqui no hay contrato de interfaz que respetar: estos estados son de la
 * misma naturaleza que los de `eventos_salida` —`pendiente`, `entregado`,
 * `apartado`— que es la tabla de la que esta copiado el mecanismo. Dentro de un
 * servicio pesa mas la coherencia con la pieza de la que se hereda.
 */

/** Redactado y a la espera del enviador. */
export const ENVIO_PENDIENTE = 'pendiente';

/**
 * Tomado por el enviador, con el `sendMail` en vuelo o ya devuelto.
 *
 * UNA FILA QUE SE QUEDA AQUI NO SE REINTENTA SOLA. Es el estado que existe para
 * que el corte entre «mandar» y «anotar que se mando» no acabe en un correo
 * repetido: si el proceso muere con el mensaje en vuelo, nadie sabe si salio, y
 * ante esa duda este servicio NO reenvia. Ver la cabecera de `services/enviador.ts`.
 */
export const ENVIO_ENVIANDO = 'enviando';

/** Aceptado por el servidor de correo. Terminal. */
export const ENVIO_ENVIADO = 'enviado';

/** Agoto los intentos. Deja de intentarse y queda a la vista. Terminal. */
export const ENVIO_APARTADO = 'apartado';

/**
 * NO HAY ESTADO `fallido`, Y ES DELIBERADO.
 *
 * Un fallo conocido devuelve la fila a `pendiente` con `intentos` incrementado,
 * `ultimo_error` escrito y `proximo_intento_en` en el futuro — exactamente lo que
 * hace `marcarFallo()` con la tabla de salida, que tampoco tiene ese estado.
 *
 * La alternativa era un `fallido` que el barrido tambien recogiera, y entonces
 * habria dos estados que significan «esto se va a reintentar». Lo que distingue a
 * una fila que ha fallado es `intentos > 0` y su `ultimo_error`, no un estado
 * aparte; un estado que nadie escribe ni consulta es una mentira sobre el modelo.
 */

export const ESTADOS_ENVIO = [
  ENVIO_PENDIENTE,
  ENVIO_ENVIANDO,
  ENVIO_ENVIADO,
  ENVIO_APARTADO,
] as const;

/**
 * Canal de entrega. Catalogo ABIERTO, sin `CHECK` en la migracion.
 *
 * Hoy hay uno. Se deja abierto por el mismo criterio que el `tipo` de Anexos: un
 * catalogo cerrado que se queda corto obliga a una migracion, y aqui el dia que
 * haya SMS o aviso en la app el valor nuevo no cambia nada del mecanismo.
 */
export const CANAL_EMAIL = 'EMAIL';
