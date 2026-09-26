/**
 * Sesión del usuario, en memoria. El token no se guarda en `localStorage`,
 * `sessionStorage` ni cookies, así que recargar la página cierra la sesión.
 * `useSesion()` re-renderiza cuando la sesión cambia.
 */

import { useEffect, useState } from 'react';

export const ROL_PROPIETARIO = 'PROPIETARIO';
export const ROL_INQUILINO = 'INQUILINO';

const SESION_VACIA = { token: null, usuario: null, debeCambiar: false };

let sesion = SESION_VACIA;
const suscriptores = new Set();

const notificar = () => {
    for (const suscriptor of suscriptores) {
        suscriptor(sesion);
    }
};

/**
 * Guarda la sesión devuelta por `POST /api/auth/login`. `debeCambiar` marca a
 * quien debe cambiar su contraseña antes de usar la aplicación.
 */
export const guardarSesion = ({ token, usuario }) => {
    sesion = {
        token,
        usuario,
        debeCambiar: Boolean(usuario && usuario.debe_cambiar_contrasena)
    };
    notificar();
};

/** Marca el cambio de contraseña como pendiente, sin tocar el token. La llama el interceptor. */
export const marcarCambioRequerido = () => {
    if (!sesion.debeCambiar) {
        sesion = { ...sesion, debeCambiar: true };
        notificar();
    }
};

/** Borra la sesión. La llama el logout y también el interceptor ante un 401. */
export const limpiarSesion = () => {
    sesion = SESION_VACIA;
    notificar();
};

export const obtenerToken = () => sesion.token;

/** ¿Tiene el usuario este rol? Consulta el arreglo `roles`, no el `rol` singular. */
export const tieneRol = (rol) =>
    Array.isArray(sesion.usuario?.roles) && sesion.usuario.roles.includes(rol);

export const esPropietario = () => tieneRol(ROL_PROPIETARIO);

/** Suscribe a los cambios de sesión. Devuelve la función para darse de baja. */
export const suscribir = (suscriptor) => {
    suscriptores.add(suscriptor);
    return () => suscriptores.delete(suscriptor);
};

/** Hook de React: re-renderiza el componente cuando cambia la sesión. */
export const useSesion = () => {
    const [estado, setEstado] = useState(sesion);

    useEffect(() => suscribir(setEstado), []);

    return {
        token: estado.token,
        usuario: estado.usuario,
        autenticado: estado.token !== null,
        debeCambiar: estado.debeCambiar === true,
        esPropietario: Array.isArray(estado.usuario?.roles)
            ? estado.usuario.roles.includes(ROL_PROPIETARIO)
            : false
    };
};
