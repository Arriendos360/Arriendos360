/**
 * Tipos primitivos compartidos por los contratos de interfaz.
 *
 * Son alias de `string` / `number`: TypeScript no valida el formato en tiempo de
 * compilacion. Existen para que la firma del DTO diga que forma espera el
 * documento, y para que la validacion en runtime tenga un solo lugar de
 * referencia.
 */

/**
 * Identificador universal. Segun el Capitulo 2, todos los identificadores del
 * modelo canonico son UUID, generados en la aplicacion con `crypto.randomUUID()`
 * y no con un `DEFAULT` de la base.
 */
export type UUID = string;

/** Fecha sin hora, en formato `YYYY-MM-DD`. */
export type FechaISO = string;

/**
 * Fecha con hora en UTC, en formato `YYYY-MM-DDTHH:mm:ssZ`.
 *
 * Convencion del proyecto: se guarda en UTC y se presenta en `America/Bogota`.
 */
export type FechaHoraISO = string;

/**
 * Dia del mes, de 1 a 31.
 *
 * Existe para `fecha_limite_pago`, que el documento define como un dia del mes
 * (entero) y no como una fecha. Es una trampa facil de pisar.
 */
export type DiaDelMes = number;

/**
 * Monto en pesos colombianos.
 *
 * Se persiste como `NUMERIC` en PostgreSQL, nunca como `float`. En el limite de
 * la API viaja como numero JSON.
 */
export type MontoCOP = number;
