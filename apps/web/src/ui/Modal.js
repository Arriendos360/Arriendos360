import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { FOCO, unir } from './clases';

/**
 * Diálogo modal. Escape y el fondo lo cierran; al abrir recibe el foco y al
 * cerrar se lo devuelve a quien lo tenía. `acciones` va al pie (los botones).
 */
export default function Modal({ abierto, onCerrar, titulo, acciones, ancho = 'max-w-lg', children }) {
    const idTitulo = useId();
    const panel = useRef(null);
    // En un ref para que un `onCerrar` escrito en línea no reinicie el efecto (y el foco) en cada render.
    const cerrar = useRef(onCerrar);
    cerrar.current = onCerrar;

    useEffect(() => {
        if (!abierto) return undefined;
        const previo = document.activeElement;
        panel.current?.focus();
        const alTeclear = (evento) => {
            if (evento.key === 'Escape') cerrar.current?.();
        };
        document.addEventListener('keydown', alTeclear);
        return () => {
            document.removeEventListener('keydown', alTeclear);
            previo?.focus?.();
        };
    }, [abierto]);

    if (!abierto) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-velo"
            onMouseDown={(evento) => {
                if (evento.target === evento.currentTarget) onCerrar?.();
            }}
        >
            <div
                ref={panel}
                role="dialog"
                aria-modal="true"
                aria-labelledby={idTitulo}
                tabIndex={-1}
                className={unir(
                    'box-border w-full max-h-[90vh] overflow-y-auto bg-superficie rounded-tarjeta p-6 outline-none',
                    ancho
                )}
            >
                <header className="flex items-start justify-between gap-4 mb-4">
                    <h2 id={idTitulo} className="m-0 text-lg font-medium text-texto">{titulo}</h2>
                    <button
                        type="button"
                        onClick={onCerrar}
                        aria-label="Cerrar"
                        className={unir(
                            'inline-flex p-1 m-0 bg-transparent border-0 rounded-chip text-texto-suave cursor-pointer hover:bg-lavanda',
                            FOCO
                        )}
                    >
                        <X size={18} aria-hidden="true" />
                    </button>
                </header>
                {children}
                {acciones && <footer className="flex justify-end gap-2 mt-6">{acciones}</footer>}
            </div>
        </div>,
        document.body
    );
}
