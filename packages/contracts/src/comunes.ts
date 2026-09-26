/** Tipos primitivos compartidos por los contratos de interfaz. */

/** UUID generado en la aplicación con `crypto.randomUUID()`. */
export type UUID = string;

/** Fecha sin hora, en formato `YYYY-MM-DD`. */
export type FechaISO = string;

/** Fecha con hora en UTC, en formato `YYYY-MM-DDTHH:mm:ssZ`. */
export type FechaHoraISO = string;

/** Día del mes, de 1 a 31. No es una fecha. */
export type DiaDelMes = number;

/** Monto en pesos colombianos. Se persiste como `NUMERIC`, nunca como `float`. */
export type MontoCOP = number;
