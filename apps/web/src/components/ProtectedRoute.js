import React from 'react';
import { Navigate } from 'react-router-dom';

import { useSesion } from '../auth/sesion';

/**
 * Guardián de ruta: exige sesión (en memoria) y, opcionalmente, un rol.
 *
 * `rolRequerido` permite cortar por rol además de por autenticación, para que
 * una URL escrita a mano no dé acceso a un módulo ajeno. No sustituye a la
 * autorización del servidor: el backend vuelve a comprobarlo siempre.
 */
const ProtectedRoute = ({ children, rolRequerido, permitirCambioPendiente = false }) => {
    const { autenticado, debeCambiar, usuario } = useSesion();

    if (!autenticado) {
        return <Navigate to="/login" replace />;
    }

    // Con la contraseña temporal sin cambiar, sólo se permite la pantalla de cambio.
    if (debeCambiar && !permitirCambioPendiente) {
        return <Navigate to="/cambiar-contrasena" replace />;
    }

    if (rolRequerido && !usuario?.roles?.includes(rolRequerido)) {
        return <Navigate to="/contratos" replace />;
    }

    return children;
};

export default ProtectedRoute;
