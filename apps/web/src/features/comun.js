/**
 * Piezas que comparten las capas de datos de `features/<dominio>/api.js`.
 *
 * Esas capas son funciones finas sobre `services/api.js`, que ya pone el token y
 * reacciona al 401. Aquí sólo vive lo que las cinco necesitan para hablar con la
 * API en sus términos: el cuerpo de la respuesta sin el sobre de axios, los montos
 * convertidos justo al enviar y los cuerpos recortados a los campos del contrato
 * de interfaz. Los errores no se tocan: siguen saliendo como errores de axios para
 * que `mensajeDeError` (src/ui/FormError.js) los traduzca.
 */

import { aDecimal } from '../ui/formato';

/** Espera la petición y devuelve sólo su cuerpo. */
export const cuerpo = async (peticion) => (await peticion).data;

/**
 * Monto para el JSON: de texto decimal canónico («1500000.5», lo que entrega
 * `MoneyField`) a número. Es el único punto donde un monto deja de ser texto, y
 * el Capítulo 2 lo pide así (`"canon": 1500000.00`). Un monto en pesos cabe de
 * sobra en un double; lo que se evita es operar con él en el navegador.
 * Lo que no es un monto sale `undefined` y el servicio responde el 400.
 */
export const montoParaEnviar = (valor) => {
    const decimal = aDecimal(valor);
    return decimal === null ? undefined : Number(decimal);
};

/**
 * Copia de `datos` con sólo los `campos` permitidos y con valor.
 *
 * Una cadena vacía cuenta como ausente: un formulario manda `''` en lo que no se
 * llenó, y guardar eso escribiría un deudor solidario sin nombre. Recortar a la
 * lista también impide mandar lo que el cliente no escribe —`id_propietario`,
 * `estado`, la auditoría— aunque el objeto del formulario lo traiga.
 */
export const soloCampos = (datos, campos) =>
    Object.fromEntries(
        campos
            .filter((campo) => datos?.[campo] !== undefined && datos[campo] !== null)
            .map((campo) => [campo, typeof datos[campo] === 'string' ? datos[campo].trim() : datos[campo]])
            .filter(([, valor]) => valor !== '')
    );
