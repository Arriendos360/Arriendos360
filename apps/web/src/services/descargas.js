/**
 * Descarga de PDF: se piden como blob por el cliente HTTP, que añade el token, y
 * se disparan con un enlace temporal. Nunca `window.open` ni `?token=`.
 */

import api from './api';

/**
 * Abre un PDF del backend en una pestaña nueva.
 *
 * @param {string} ruta   ruta relativa a la baseURL de la API, p. ej. `/pagos/${id}/recibo`
 * @param {string} nombre nombre de archivo sugerido si el usuario lo guarda
 */
export const abrirPdf = async (ruta, nombre) => {
    const respuesta = await api.get(ruta, { responseType: 'blob' });

    const url = URL.createObjectURL(
        new Blob([respuesta.data], { type: 'application/pdf' })
    );

    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    if (nombre) {
        enlace.download = nombre;
    }

    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);

    // Liberar el blob. Se espera un momento porque revocarlo de inmediato puede
    // cancelar la apertura en algunos navegadores.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * Descarga un PDF del backend a la carpeta de descargas, sin abrirlo.
 *
 * @param {string} ruta   ruta relativa a la baseURL de la API
 * @param {string} nombre nombre con el que se guarda
 */
export const descargarPdf = async (ruta, nombre) => {
    const respuesta = await api.get(ruta, { responseType: 'blob' });

    const url = URL.createObjectURL(
        new Blob([respuesta.data], { type: 'application/pdf' })
    );

    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre || 'documento.pdf';

    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
