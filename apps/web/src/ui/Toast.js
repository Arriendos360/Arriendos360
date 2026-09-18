import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { FOCO, unir } from './clases';

const ContextoToast = createContext(null);

const TONOS = {
    info: 'bg-indigo-profundo text-white',
    error: 'bg-rojo-tenue text-rojo-texto'
};

const DURACION_MS = { info: 5000, error: 8000 };

/**
 * Avisos pasajeros («Pago registrado»). Se monta una vez, alrededor de la app,
 * y cualquier pantalla llama `const { avisar } = useToast()`.
 */
export function ToastProvider({ children }) {
    const [avisos, setAvisos] = useState([]);
    const siguiente = useRef(0);

    const cerrar = useCallback((id) => {
        setAvisos((actuales) => actuales.filter((aviso) => aviso.id !== id));
    }, []);

    const avisar = useCallback((mensaje, tono = 'info') => {
        siguiente.current += 1;
        const id = siguiente.current;
        setAvisos((actuales) => [...actuales, { id, mensaje, tono }]);
        setTimeout(() => cerrar(id), DURACION_MS[tono] || DURACION_MS.info);
    }, [cerrar]);

    const valor = useMemo(() => ({ avisar }), [avisar]);

    return (
        <ContextoToast.Provider value={valor}>
            {children}
            <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
                {avisos.map((aviso) => (
                    <div
                        key={aviso.id}
                        role={aviso.tono === 'error' ? 'alert' : 'status'}
                        className={unir('flex items-start gap-3 px-4 py-3 rounded-control text-sm', TONOS[aviso.tono] || TONOS.info)}
                    >
                        <span className="flex-1">{aviso.mensaje}</span>
                        <button
                            type="button"
                            onClick={() => cerrar(aviso.id)}
                            aria-label="Cerrar aviso"
                            className={unir('inline-flex p-0 m-0 bg-transparent border-0 text-current cursor-pointer', FOCO)}
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    </div>
                ))}
            </div>
        </ContextoToast.Provider>
    );
}

export function useToast() {
    const contexto = useContext(ContextoToast);
    if (!contexto) throw new Error('useToast exige un <ToastProvider> más arriba en el árbol.');
    return contexto;
}
