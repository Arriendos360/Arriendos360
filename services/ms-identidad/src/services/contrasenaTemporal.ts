/**
 * Generacion de contrasenas temporales.
 *
 * Se usa cuando un usuario lo crea otro: el propietario da de alta a su
 * inquilino y no tiene por que elegir la credencial de otra persona. Hasta este
 * cambio el hueco lo rellenaba la cedula, que no es un secreto —el propietario
 * acaba de teclearla y la busqueda por documento la devuelve— y que ademas nadie
 * le comunicaba al inquilino.
 *
 * Ver docs/adr/0007.
 */

import crypto from 'crypto';

/**
 * Alfabeto SIN caracteres ambiguos.
 *
 * Faltan `0`/`O`, `1`/`l`/`I`. No es purismo tipografico: alguien va a leer esta
 * contrasena en voz alta o a copiarla a mano en un papel, y una `l` confundida
 * con un `1` produce un bloqueo que parece un fallo del sistema y que nadie sabe
 * diagnosticar.
 */
export const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 12 caracteres sobre 57 simbolos: unos 70 bits, de sobra para un solo uso. */
export const LONGITUD = 12;

/**
 * Genera una contrasena temporal.
 *
 * `crypto.randomInt` y no `Math.random()`: la primera es criptografica y no
 * tiene sesgo de modulo; la segunda es predecible y aqui eso significaria poder
 * adivinar la credencial de otra persona.
 */
export const generarContrasenaTemporal = (longitud: number = LONGITUD): string => {
  let resultado = '';

  for (let i = 0; i < longitud; i += 1) {
    resultado += ALFABETO[crypto.randomInt(ALFABETO.length)];
  }

  return resultado;
};
