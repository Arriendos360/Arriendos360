/**
 * Utilidades de las capas de datos `features/<dominio>/api.js`: el cuerpo de la
 * respuesta, los montos al enviar y el recorte de campos. Los errores de axios
 * pasan tal cual para que los traduzca `mensajeDeError`.
 */

import { aDecimal } from '../ui/formato';

/** Espera la petición y devuelve sólo su cuerpo. */
export const cuerpo = async (peticion) => (await peticion).data;

/**
 * Monto para el JSON: de texto decimal («1500000.5», lo que entrega `MoneyField`)
 * a número. Lo que no es un monto sale `undefined` y el servicio responde el 400.
 */
export const montoParaEnviar = (valor) => {
    const decimal = aDecimal(valor);
    return decimal === null ? undefined : Number(decimal);
};

/**
 * Copia de `datos` con sólo los `campos` permitidos y con valor. Una cadena vacía
 * cuenta como ausente.
 */
export const soloCampos = (datos, campos) =>
    Object.fromEntries(
        campos
            .filter((campo) => datos?.[campo] !== undefined && datos[campo] !== null)
            .map((campo) => [campo, typeof datos[campo] === 'string' ? datos[campo].trim() : datos[campo]])
            .filter(([, valor]) => valor !== '')
    );
