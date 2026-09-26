/** Contraseñas temporales para usuarios dados de alta por otra persona. */

import crypto from 'crypto';

/** Alfabeto sin caracteres ambiguos (`0`/`O`, `1`/`l`/`I`). */
export const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 12 caracteres sobre 57 simbolos: unos 70 bits, de sobra para un solo uso. */
export const LONGITUD = 12;

/** Genera una contraseña temporal con `crypto.randomInt`. */
export const generarContrasenaTemporal = (longitud: number = LONGITUD): string => {
  let resultado = '';

  for (let i = 0; i < longitud; i += 1) {
    resultado += ALFABETO[crypto.randomInt(ALFABETO.length)];
  }

  return resultado;
};
