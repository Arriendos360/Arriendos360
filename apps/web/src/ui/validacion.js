import { useState } from 'react';

/**
 * Errores por campo de los formularios de alta. Un `validar` recibe el estado del
 * formulario y devuelve `[{ campo, mensaje }]` en el orden de la pantalla.
 */

/** `[{ campo, mensaje }]` → `{ campo: mensaje }`. Si un campo trae varios, gana el primero. */
export const aMapa = (errores) =>
    errores.reduce((mapa, { campo, mensaje }) => (campo in mapa ? mapa : { ...mapa, [campo]: mensaje }), {});

/** El error de un solo campo según `validar`, o `undefined`. */
export const errorDeCampo = (validar, datos, campo) => aMapa(validar(datos))[campo];

/**
 * Reparte un 400 con `errores` (`errorDeValidacion`) entre los `campos` que están
 * en pantalla. `general` es el primero que no tiene dónde ir. `null` si el error
 * es de otro tipo: va entero a `FormError`.
 */
export const erroresDelServidor = (error, campos) => {
    const lista = error?.response?.status === 400 ? error.response.data?.errores : null;
    if (!Array.isArray(lista) || lista.length === 0) return null;

    const fuera = lista.find(({ campo }) => !campos.includes(campo));
    return {
        errores: aMapa(lista.filter(({ campo }) => campos.includes(campo))),
        general: fuera ? fuera.mensaje : null
    };
};

const vacio = (valor) => valor === undefined || valor === null || String(valor).trim() === '';

/**
 * Errores visibles de un formulario: un campo al salir de él, todos al enviar, y se
 * borra el de un campo al editarlo. `hayErrores` mira los visibles, no la validez:
 * así el botón empieza habilitado y es el envío el que avisa.
 */
export function useValidacion(validar, campos) {
    const [errores, setErrores] = useState({});

    const poner = (campo, mensaje) =>
        setErrores(({ [campo]: _anterior, ...resto }) => (mensaje ? { ...resto, [campo]: mensaje } : resto));
    const revisar = (campo, datos) => poner(campo, errorDeCampo(validar, datos, campo));

    return {
        errores,
        hayErrores: Object.keys(errores).length > 0,
        revisar,
        /** Un campo vacío no se marca al pasar por él: «obligatorio» se avisa al enviar. */
        alSalir: (campo, datos) => {
            if (!vacio(datos[campo])) revisar(campo, datos);
        },
        limpiar: (campo) => poner(campo, undefined),
        /** Valida todo y devuelve si se puede enviar. */
        alEnviar: (datos) => {
            const mapa = aMapa(validar(datos));
            setErrores(mapa);
            return Object.keys(mapa).length === 0;
        },
        /** Reparte el error de la API bajo sus campos y devuelve lo que queda para `FormError`. */
        delServidor: (error) => {
            const repartidos = erroresDelServidor(error, campos);
            if (!repartidos) return error;
            setErrores(repartidos.errores);
            return repartidos.general;
        }
    };
}
