/** Reglas del formulario de inmueble, iguales al crear y al editar. */

import { validarInmueble } from 'arriendos360-contracts';

/** La coma decimal se escribe en Colombia; NUMERIC la espera con punto. */
export const paraEnviar = (form) => ({ ...form, area_m2: form.area_m2.trim().replace(',', '.') });

/** Errores del formulario con las reglas de ms-inmuebles, sobre lo que se enviaría. */
export const validarFormularioInmueble = (form) => validarInmueble(paraEnviar(form)).errores;
