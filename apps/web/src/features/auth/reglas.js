/**
 * Reglas de las pantallas de autenticación que no dependen de React, para
 * probarlas sin montar componentes.
 */

import { mensajeDeError } from '../../ui/FormError';

/**
 * Estados con los que responde un servicio que está despertando (escala a cero): el
 * login los reintenta con espera creciente en vez de mostrarlos como error.
 */
export const ESTADOS_DESPERTANDO = [502, 503, 504];
export const ESPERAS_REINTENTO_MS = [3000, 6000, 12000];

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export const estaDespertando = (error) => !error?.response || ESTADOS_DESPERTANDO.includes(error.response.status);

/**
 * Ejecuta `peticion` y la repite mientras el servicio esté despertando.
 * `alReintentar` se llama antes de cada espera; el último error se relanza.
 */
export const conReintentos = async (peticion, { alReintentar = () => {}, esperas = ESPERAS_REINTENTO_MS, esperar = dormir } = {}) => {
    for (let intento = 0; ; intento += 1) {
        try {
            return await peticion();
        } catch (error) {
            if (!estaDespertando(error) || intento >= esperas.length) throw error;
            alReintentar(intento);
            await esperar(esperas[intento]);
        }
    }
};

/**
 * Texto del error del login. El 401 es siempre «credenciales incorrectas»: el
 * servicio no distingue si el correo existe, y la pantalla tampoco.
 */
export const mensajeDeLogin = (error) => {
    if (error?.response?.status === 401) return error.response.data?.mensaje || 'Correo o contraseña incorrectos.';
    if (estaDespertando(error)) return 'El servicio no respondió. Inténtalo de nuevo en un momento.';
    return mensajeDeError(error);
};

/** Mínimo que exige ms-identidad al cambiar o restablecer (LONGITUD_MINIMA_CONTRASENA). */
export const LONGITUD_MINIMA = 8;

/**
 * Valida una contraseña nueva antes de mandarla. Devuelve el mensaje del
 * primer problema, o `null`. `actual` sólo se compara si viene.
 */
export const validarContrasenaNueva = ({ nueva, confirmar, actual }) => {
    if (nueva.length < LONGITUD_MINIMA) return `La contraseña debe tener al menos ${LONGITUD_MINIMA} caracteres.`;
    if (nueva !== confirmar) return 'Las contraseñas no coinciden.';
    if (actual !== undefined && nueva === actual) return 'La contraseña nueva debe ser distinta de la actual.';
    return null;
};
