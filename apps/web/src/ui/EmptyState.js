import { Inbox } from 'lucide-react';

export default function EmptyState({ icono: Icono = Inbox, titulo, descripcion, accion }) {
    return (
        <div className="flex flex-col items-center text-center gap-2 py-10 px-4">
            <span className="flex items-center justify-center w-11 h-11 rounded-control bg-chip text-indigo-medio">
                <Icono size={20} aria-hidden="true" />
            </span>
            <p className="m-0 mt-1 text-sm font-medium text-texto">{titulo}</p>
            {descripcion && <p className="m-0 max-w-sm text-sm text-texto-suave">{descripcion}</p>}
            {accion && <div className="mt-2">{accion}</div>}
        </div>
    );
}
