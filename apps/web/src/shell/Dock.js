import { NavLink } from 'react-router-dom';
import { ArrowLeftToLine, LogOut } from 'lucide-react';

import { FOCO, unir } from '../ui/clases';
import { estaOculto } from './useModoNavegacion';

const CONTROL = unir(
    'group relative box-border flex items-center justify-center w-12 h-12 m-0 p-0 rounded-control',
    'border-0 no-underline cursor-pointer transition-[transform,background-color] duration-200',
    'motion-safe:hover:scale-110',
    FOCO
);
const INACTIVO = 'bg-transparent hover:bg-white/60';

// El nombre accesible es el `aria-label` del control: el globo sólo se ve.
const Globo = ({ children }) => (
    <span
        aria-hidden="true"
        className="absolute -top-10 scale-0 group-hover:scale-100 group-focus-visible:scale-100 transition-transform motion-reduce:transition-none bg-texto text-white text-xs py-1 px-2 rounded-chip whitespace-nowrap pointer-events-none"
    >
        {children}
    </span>
);

const Separador = ({ className }) => <span aria-hidden="true" className={unir('w-px h-8 mx-1 bg-texto-suave opacity-30', className)} />;

/**
 * Navegación flotante: sólo iconos, con su nombre en un globo. Bajo `md` es la única
 * navegación y no lleva botón de cambio; desde `md` sólo se ve en modo dock.
 */
export default function Dock({ enDock, enlaces, fase, alternar, salir, saliendo, refCambio }) {
    const estado = estaOculto(fase)
        ? 'translate-y-24 scale-95 opacity-0 pointer-events-none'
        : 'translate-y-0 scale-100 opacity-100';

    return (
        <div
            className={unir(
                'flex items-center gap-1 fixed bottom-6 left-1/2 z-40 -translate-x-1/2 box-border p-2',
                'bg-white/70 backdrop-blur-md border border-solid border-white/40 rounded-dock shadow-dock',
                'transition-[transform,opacity] duration-300 ease-in-out',
                !enDock && 'md:hidden',
                estado
            )}
        >
            {enDock && (
                <>
                    <button
                        id="btn-to-sidebar"
                        ref={refCambio}
                        type="button"
                        className={unir(CONTROL, INACTIVO, 'text-indigo-profundo hidden md:flex')}
                        aria-label="Fijar menú lateral"
                        title="Fijar menú lateral"
                        onClick={alternar}
                    >
                        <ArrowLeftToLine size={22} aria-hidden="true" />
                        <Globo>Fijar lateral</Globo>
                    </button>

                    <Separador className="hidden md:block" />
                </>
            )}

            <nav aria-label="Principal" className="flex items-center gap-1">
                {enlaces.map(({ to, etiqueta, icono: Icono, exacto }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={exacto}
                        aria-label={etiqueta}
                        className={({ isActive }) => unir(CONTROL, isActive ? 'bg-indigo-medio text-white' : unir(INACTIVO, 'text-indigo-profundo'))}
                    >
                        <Icono size={22} aria-hidden="true" />
                        <Globo>{etiqueta}</Globo>
                    </NavLink>
                ))}
            </nav>

            <Separador />

            <button
                type="button"
                className={unir(CONTROL, INACTIVO, 'text-rojo-texto')}
                aria-label={saliendo ? 'Cerrando sesión' : 'Cerrar sesión'}
                onClick={salir}
                disabled={saliendo}
            >
                <LogOut size={22} aria-hidden="true" />
                <Globo>{saliendo ? 'Cerrando…' : 'Cerrar sesión'}</Globo>
            </button>
        </div>
    );
}
