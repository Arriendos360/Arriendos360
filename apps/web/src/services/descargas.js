/**
 * Descarga de PDF con el token en memoria.
 *
 * Antes los recibos se abrían con `window.open(url + '?token=' + token)`, que
 * obligaba al backend a aceptar el token por query string. Eso se acabó: el
 * token ya no está en `localStorage` para poder concatenarlo, y un token en la
 * URL queda en los logs del servidor, en el historial del navegador y en la
 * cabecera `Referer`.
 *
 * El reemplazo que fija el Capítulo 2: pedir el archivo con el mismo cliente
 * HTTP (y por tanto con el mismo interceptor que pone la cabecera), recibirlo
 * como blob y dispararlo con un enlace temporal.
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
 * Descarga un PDF del backend forzando el guardado.
 *
 * Igual que `abrirPdf` pero sin `target="_blank"`: para un anexo interesa que el
 * archivo caiga en Descargas con un nombre reconocible, no que se abra en una
 * pestana. El backend lo sirve con `Content-Disposition: attachment` por la
 * misma razon, y ademas porque es contenido que sube un usuario y se lo descarga
 * otro.
 *
 * AQUI ABAJO ESTABA `urlArchivoSubido`, que componia la URL publica de
 * `/uploads`. Se fue con el propio `/uploads`: los anexos ya no tienen URL
 * publica, salen por `GET /api/contratos/:id/anexos/:idAnexo` con el token en la
 * cabecera. Que no exista la funcion es lo que impide volver a enlazarlos por
 * accidente.
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
