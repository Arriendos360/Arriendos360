import { AlertCircle } from 'lucide-react';

import { unir } from './clases';

/**
 * Traduce un error a un texto para la persona. La API responde `{ mensaje }`
 * (convención del proyecto); si no hay cuerpo, se explica por el estado.
 * Acepta un error de axios, un `{ mensaje }` o una cadena.
 */
export function mensajeDeError(error) {
    if (!error) return null;
    if (typeof error === 'string') return error;

    const respuesta = error.response;
    if (respuesta?.data?.mensaje) return respuesta.data.mensaje;
    if (!respuesta && error.mensaje) return error.mensaje;
    if (!respuesta) return 'No hay conexión con el servidor. Revisa tu red e intenta de nuevo.';

    switch (respuesta.status) {
        case 403: return 'No tienes permiso para hacer esto.';
        case 404: return 'No encontramos lo que buscas.';
        case 429: return 'Demasiados intentos. Espera un momento antes de volver a intentar.';
        // El gateway da 502 cuando un servicio no responde, p. ej. mientras despierta.
        case 502:
        case 503:
        case 504: return 'Un servicio no respondió. Intenta de nuevo en unos segundos.';
        default: return 'Ocurrió un error inesperado. Intenta de nuevo.';
    }
}

/** Aviso de error de un formulario o de una carga. No pinta nada sin error. */
export default function FormError({ error, className }) {
    const mensaje = mensajeDeError(error);
    if (!mensaje) return null;
    return (
        <div
            role="alert"
            className={unir('flex items-start gap-2 px-3 py-2.5 rounded-control bg-rojo-tenue text-rojo-texto text-sm', className)}
        >
            <AlertCircle size={16} aria-hidden="true" className="shrink-0 mt-0.5" />
            <span>{mensaje}</span>
        </div>
    );
}
