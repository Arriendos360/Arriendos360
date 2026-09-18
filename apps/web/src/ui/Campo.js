import { useId } from 'react';

import { ETIQUETA } from './clases';

/**
 * Envoltura común de los campos: etiqueta, ayuda y error, enlazados al control
 * por `id` y `aria-describedby`. `children` es una función que recibe esas
 * propiedades para ponérselas al control.
 */
export default function Campo({ etiqueta, ayuda, error, id, className, children }) {
    const generado = useId();
    const idControl = id || generado;
    const idAyuda = ayuda ? `${idControl}-ayuda` : undefined;
    const idError = error ? `${idControl}-error` : undefined;

    return (
        <div className={className}>
            {etiqueta && <label htmlFor={idControl} className={ETIQUETA}>{etiqueta}</label>}
            {children({
                id: idControl,
                'aria-invalid': error ? true : undefined,
                'aria-describedby': [idAyuda, idError].filter(Boolean).join(' ') || undefined
            })}
            {ayuda && <p id={idAyuda} className="m-0 mt-1 text-xs text-texto-suave">{ayuda}</p>}
            {error && <p id={idError} className="m-0 mt-1 text-xs text-rojo-texto">{error}</p>}
        </div>
    );
}
