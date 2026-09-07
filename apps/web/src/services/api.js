import axios from 'axios';

import { limpiarSesion, marcarCambioRequerido, obtenerToken } from '../auth/sesion';

const api = axios.create({
    baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001/api'
});

/**
 * Interceptor de petición: adjunta `Authorization: Bearer <token>` a toda
 * llamada saliente. El token se lee de memoria, no de `localStorage`.
 */
api.interceptors.request.use((config) => {
    const token = obtenerToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

/**
 * Interceptor de respuesta: un 401 significa que el token falta o fue revocado
 * (cierre de sesión desde otra pestaña, por ejemplo), así que se limpia la
 * sesión y los guardianes de ruta devuelven al login solos.
 *
 * El 403 NO limpia la sesión: ahí el token es válido y lo que falla es el
 * permiso sobre ese recurso concreto.
 */
api.interceptors.response.use(
    (respuesta) => respuesta,
    (error) => {
        if (error.response?.status === 401) {
            limpiarSesion();
        }

        // El gateway deniega todo a quien tiene la contraseña temporal sin
        // cambiar. Se marca la sesión y los guardianes de ruta llevan a la
        // pantalla de cambio, en vez de mostrar un 403 que no explica nada.
        if (error.response?.data?.error_code === 'CAMBIO_CONTRASENA_REQUERIDO') {
            marcarCambioRequerido();
        }

        return Promise.reject(error);
    }
);

export default api;
