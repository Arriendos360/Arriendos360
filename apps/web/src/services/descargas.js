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
 * URL de un archivo servido desde `/uploads` (los PDF de contrato).
 *
 * OJO: `/uploads` lo sirve `express.static` sin pasar por `verificarToken`, así
 * que esos archivos son públicos para quien conozca la URL. El código anterior
 * le pegaba `?token=` y eso nunca sirvió de nada, porque `express.static` no
 * mira cabeceras ni query. Aquí se quita el parámetro para no dar la impresión
 * de que protege algo.
 *
 * Queda pendiente servir los anexos por una ruta autenticada. El paso 6 lo
 * resuelve de raíz al mover los archivos a almacenamiento en la nube y guardar
 * sólo la URL firmada.
 */
export const urlArchivoSubido = (rutaAbsoluta) => {
    const base = (process.env.REACT_APP_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');
    return `${base}${rutaAbsoluta}`;
};
