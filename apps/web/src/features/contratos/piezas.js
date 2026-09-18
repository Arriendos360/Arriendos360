/**
 * Piezas que comparten la lista y el detalle de contratos.
 */

import { KeyRound } from 'lucide-react';

import { CONTROL, CONTROL_CON_ERROR, unir } from '../../ui/clases';
import Campo from '../../ui/Campo';
import { formatearFecha } from '../../ui/formato';
import { fechaDeContrato } from './api';

/**
 * ¿Actúa como propietario sobre ESTE contrato? No basta el rol: un usuario con
 * los dos roles es inquilino en los contratos donde figura como tal, y ahí no
 * ve acciones de propietario. El backend lo vuelve a decidir (regla dura 8).
 */
export const actuaComoPropietario = (contrato, sesion) =>
    Boolean(sesion.esPropietario && contrato && contrato.id_inquilino !== sesion.usuario?.id);

/** «Nombres Apellidos», o `null` si la decoración no llegó. */
export const nombreDe = (persona) =>
    persona ? [persona.nombres, persona.apellidos].filter(Boolean).join(' ') || null : null;

export const vigencia = (contrato) =>
    `${formatearFecha(fechaDeContrato(contrato.inicio))} – ${formatearFecha(fechaDeContrato(contrato.fin))}`;

/** Ubicación corta del inmueble decorado: «Chicó, Bogotá D.C.». */
export const ubicacionDe = (inmueble) =>
    inmueble ? [inmueble.barrio, inmueble.municipio].filter(Boolean).join(', ') : '';

/** Área de texto con el aspecto de los controles del kit. */
export function AreaTexto({ etiqueta, ayuda, error, id, className, ...resto }) {
    return (
        <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} id={id} className={className}>
            {(enlace) => (
                <textarea {...enlace} {...resto} rows={3}
                    className={unir(CONTROL, 'h-auto py-2 resize-y', error && CONTROL_CON_ERROR)} />
            )}
        </Campo>
    );
}

/**
 * La contraseña temporal, que viaja en claro una sola vez (docs/adr/0007). Se
 * muestra para entregarla en mano; el correo sólo avisa que la cuenta existe.
 */
export function ContrasenaTemporal({ contrasena, persona }) {
    return (
        <div className="flex flex-col gap-2 bg-lavanda border border-solid border-borde rounded-control p-4">
            <p className="m-0 flex items-center gap-2 text-sm font-medium text-texto">
                <KeyRound size={16} aria-hidden="true" /> Contraseña temporal{persona ? ` de ${persona}` : ''}
            </p>
            <code className="block text-lg font-medium tracking-wide text-indigo-medio break-all select-all">{contrasena}</code>
            <p className="m-0 text-xs text-texto-suave">
                Cópiala y entrégala en persona: no se vuelve a mostrar. Al entrar, el sistema le pedirá elegir una propia.
            </p>
        </div>
    );
}
