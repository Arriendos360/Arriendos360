/**
 * Sesión del usuario, en memoria.
 *
 * El token vive en una variable de módulo y NO en `localStorage`, `sessionStorage`
 * ni cookies. Es la Capa 1 del módulo de seguridad del Capítulo 2: un token en
 * `localStorage` es legible por cualquier script que llegue a ejecutarse en la
 * página, así que un XSS en una dependencia de la SPA se lleva la sesión entera.
 *
 * CONSECUENCIA ASUMIDA: recargar la página (F5) cierra la sesión y devuelve al
 * login. Es el precio de no persistir el token, y el diseño lo acepta a
 * conciencia; la alternativa sería un refresh token en cookie `HttpOnly`, que no
 * está en el alcance de este paso.
 *
 * El estado se publica por suscripción para que React vuelva a pintar cuando la
 * sesión cambia. `useSesion()` es el hook que usan los componentes.
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
 * Guarda la sesión devuelta por `POST /api/auth/login`.
 *
 * `debeCambiar` marca a quien entró con una contraseña que no eligió: mientras
 * esté activo la API le deniega todo salvo cambiarla, así que la SPA lo lleva
 * directo a esa pantalla. Ver docs/adr/0007.
 */
export const guardarSesion = ({ token, usuario }) => {
    sesion = {
        token,
        usuario,
        debeCambiar: Boolean(usuario && usuario.debe_cambiar_contrasena)
    };
    notificar();
};

/**
 * Marca el cambio como pendiente sin tocar el token.
 *
 * La llama el interceptor cuando la API responde CAMBIO_CONTRASENA_REQUERIDO:
 * puede pasar que el token siga siendo válido y la SPA no se hubiera enterado,
 * por ejemplo si el estado cambió en otra pestaña.
 */
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

/**
 * ¿Tiene el usuario este rol?
 *
 * Consulta el arreglo `roles`, no el `rol` singular. El singular sirve para
 * decidir qué mostrar por defecto; los permisos se leen del arreglo, porque un
 * usuario puede ser propietario e inquilino a la vez.
 */
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
