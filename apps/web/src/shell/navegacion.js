/**
 * Qué muestra la barra lateral, según el arreglo `roles` del claim.
 *
 * Se lee `roles` y no el `rol` singular: un usuario puede ser propietario e
 * inquilino a la vez, y el singular sólo dice cuál es el principal. Esconder un
 * enlace es comodidad, no seguridad: el guardián de ruta y el backend lo vuelven
 * a comprobar.
 */

import { LayoutDashboard, Home, FileText, CreditCard } from 'lucide-react';

import { ROL_INQUILINO, ROL_PROPIETARIO } from '../auth/sesion';

// `soloInquilino` es la etiqueta de quien sólo ve lo suyo como arrendatario.
// Con los dos roles la pantalla lista contratos de ambos lados, así que va en plural.
const ENLACES = [
    { to: '/', etiqueta: 'Dashboard', icono: LayoutDashboard, roles: [ROL_PROPIETARIO], exacto: true },
    { to: '/inmuebles', etiqueta: 'Inmuebles', icono: Home, roles: [ROL_PROPIETARIO] },
    { to: '/contratos', etiqueta: 'Contratos', soloInquilino: 'Mi contrato', icono: FileText, roles: [ROL_PROPIETARIO, ROL_INQUILINO] },
    { to: '/pagos', etiqueta: 'Pagos', soloInquilino: 'Mis pagos', icono: CreditCard, roles: [ROL_PROPIETARIO, ROL_INQUILINO] }
];

const rolesDe = (usuario) => (Array.isArray(usuario?.roles) ? usuario.roles : []);

/** Enlaces visibles para el usuario, con la etiqueta que le corresponde. */
export const enlacesPara = (usuario) => {
    const roles = rolesDe(usuario);
    const soloInquilino = roles.includes(ROL_INQUILINO) && !roles.includes(ROL_PROPIETARIO);

    return ENLACES
        .filter((enlace) => enlace.roles.some((rol) => roles.includes(rol)))
        .map(({ roles: _roles, soloInquilino: etiquetaInquilino, ...enlace }) => ({
            ...enlace,
            etiqueta: soloInquilino && etiquetaInquilino ? etiquetaInquilino : enlace.etiqueta
        }));
};

const NOMBRES_ROL = { [ROL_PROPIETARIO]: 'Propietario', [ROL_INQUILINO]: 'Inquilino' };

/** «Propietario», «Inquilino» o «Propietario · Inquilino», en orden fijo. */
export const etiquetaDeRoles = (usuario) => {
    const roles = rolesDe(usuario);
    return [ROL_PROPIETARIO, ROL_INQUILINO]
        .filter((rol) => roles.includes(rol))
        .map((rol) => NOMBRES_ROL[rol])
        .join(' · ');
};
