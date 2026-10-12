/** Reglas del formulario de nuevo contrato: los pasos del flujo y las de los servicios. */

import { validarAltaInquilino, validarContrato } from 'arriendos360-contracts';

import { aMapa } from '../../ui/validacion';

/** El error de cédula del documento del inquilino, o `undefined`. Se mira antes de buscarlo. */
export const errorDeDocumento = (documento) => aMapa(validarAltaInquilino({ documento }).errores).documento;

/** Errores del contrato en el orden de la pantalla. `inquilino` es el ya encontrado o dado de alta. */
export const validarFormularioContrato = (form, inquilino) => {
    const documento = inquilino ? undefined : errorDeDocumento(form.documento) ?? 'Busca al inquilino por su documento o dalo de alta.';
    return [
        ...(form.id_inmueble ? [] : [{ campo: 'id_inmueble', mensaje: 'Elige el inmueble.' }]),
        ...(documento ? [{ campo: 'documento', mensaje: documento }] : []),
        ...validarContrato(form).errores
    ];
};

/** Alta del inquilino que no existía: su documento es el que se buscó. */
export const validarAlta = (alta) => validarAltaInquilino(alta).errores;
