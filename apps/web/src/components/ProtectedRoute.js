import React from 'react';
import { Navigate } from 'react-router-dom';

import { useSesion } from '../auth/sesion';

/**
 * Guardián de ruta (Capa 1 del módulo de seguridad).
 *
 * Lee la sesión de memoria en vez de `localStorage`. Como consecuencia, recargar
 * la página devuelve al login: el token no sobrevive al refresco, y eso es
 * deliberado.
 *
 * `rolRequerido` permite cortar por rol además de por autenticación, para que
 * una URL escrita a mano no dé acceso a un módulo ajeno. No sustituye a la
 * autorización del servidor: el backend vuelve a comprobarlo siempre.
 */
const ProtectedRoute = ({ children, rolRequerido }) => {
    const { autenticado, usuario } = useSesion();

    if (!autenticado) {
        return <Navigate to="/login" replace />;
    }

    if (rolRequerido && !usuario?.roles?.includes(rolRequerido)) {
        return <Navigate to="/contratos" replace />;
    }

    return children;
};

export default ProtectedRoute;
