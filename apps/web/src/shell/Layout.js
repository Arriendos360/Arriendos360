import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowRightToLine, Building2, LogOut } from 'lucide-react';

import { limpiarSesion, useSesion } from '../auth/sesion';
import { cerrarSesion } from '../features/auth/api';
import { FOCO, unir } from '../ui/clases';
import Dock from './Dock';
import { enlacesPara, etiquetaDeRoles, MODO_DOCK } from './navegacion';
import useModoNavegacion, { estaOculto } from './useModoNavegacion';

// Ítems de la barra: sólido `indigo-medio` el activo, lavanda clara el resto (marca.md).
const ITEM = unir(
    'box-border flex items-center gap-3 w-full m-0 px-3 py-2.5 rounded-control',
    'font-sans text-sm font-medium no-underline border-0 cursor-pointer',
    FOCO
);
const ITEM_INACTIVO = 'bg-transparent text-chip hover:bg-white/10';
const ITEM_ACTIVO = 'bg-indigo-medio text-white';

const Logo = () => (
    <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-8 h-8 rounded-logo bg-white/15 text-white">
            <Building2 size={18} aria-hidden="true" />
        </span>
        <span className="text-base font-medium text-white">Arriendos360</span>
    </div>
);

/**
 * Armazón de las pantallas autenticadas: navegación y contenido.
 *
 * La navegación se arma con `roles` del claim (ver `navegacion.js`). En pantallas
 * angostas es siempre el dock flotante. En las anchas se elige entre el dock y la
 * barra, que es `sticky`. El contenedor no recorta (`overflow-hidden`): lo ancho se
 * desplaza dentro de `main`.
 */
export default function Layout({ children }) {
    const navigate = useNavigate();
    const { usuario } = useSesion();
    const [saliendo, setSaliendo] = useState(false);
    const { modo, fase, alternar } = useModoNavegacion();
    const enDock = modo === MODO_DOCK;

    // El botón pulsado desaparece con su modo: sin esto, el foco caería en `body`.
    const botonDeCambio = useRef(null);
    const moverFoco = useRef(false);
    useEffect(() => {
        if (!moverFoco.current) return;
        moverFoco.current = false;
        botonDeCambio.current?.focus({ preventScroll: true });
    }, [modo]);

    const cambiarModo = () => {
        moverFoco.current = true;
        alternar();
    };

    const enlaces = enlacesPara(usuario);
    const nombre = [usuario?.nombres, usuario?.apellidos].filter(Boolean).join(' ');

    /**
     * Avisa al servidor para que anote el `jti` en TokensRevocados; si no, el
     * token seguiría valiendo hasta expirar. Si la llamada falla (sin red, token
     * ya vencido) la sesión local se cierra igual: dejar a la persona dentro
     * sería peor.
     */
    const salir = async () => {
        setSaliendo(true);
        try {
            await cerrarSesion();
        } catch (error) {
            // Se cierra igual; ver arriba.
        } finally {
            limpiarSesion();
            navigate('/login', { replace: true });
        }
    };

    return (
        <div className="box-border min-h-screen bg-lavanda font-sans text-texto md:p-4">
            <div className="flex flex-col md:flex-row min-h-screen md:min-h-[calc(100vh-2rem)] bg-lavanda md:border md:border-solid md:border-borde md:rounded-app">
                <aside
                    className={unir(
                        enDock ? 'hidden' : 'hidden md:flex',
                        'flex-col shrink-0 w-60 bg-indigo-profundo px-4 py-6 sticky top-4 self-start h-[calc(100vh-2rem)] box-border overflow-y-auto rounded-l-app',
                        'transition-[transform,opacity] duration-300 ease-in-out',
                        estaOculto(fase) && '-translate-x-full opacity-0 pointer-events-none'
                    )}
                >
                    <div className="flex items-center justify-between">
                        <Logo />
                        {!enDock && (
                            <button
                                id="btn-to-dock"
                                ref={botonDeCambio}
                                type="button"
                                className={unir('flex items-center justify-center w-8 h-8 m-0 p-0 rounded-control border-0 bg-white/10 text-white cursor-pointer hover:bg-white/25 transition-colors', FOCO)}
                                aria-label="Cambiar a menú flotante"
                                title="Cambiar a menú flotante"
                                onClick={cambiarModo}
                            >
                                <ArrowRightToLine size={16} aria-hidden="true" />
                            </button>
                        )}
                    </div>

                    <div className="flex flex-col flex-1">
                        <p className="m-0 mt-3 mb-6 text-xs font-medium uppercase tracking-label text-chip">
                            {etiquetaDeRoles(usuario)}
                        </p>

                        <nav aria-label="Principal" className="flex flex-col gap-1">
                            {enlaces.map(({ to, etiqueta, icono: Icono, exacto }) => (
                                <NavLink
                                    key={to}
                                    to={to}
                                    end={exacto}
                                    className={({ isActive }) => unir(ITEM, isActive ? ITEM_ACTIVO : ITEM_INACTIVO)}
                                >
                                    <Icono size={18} aria-hidden="true" />
                                    {etiqueta}
                                </NavLink>
                            ))}
                        </nav>

                        <div className="mt-auto pt-4 border-0 border-t border-solid border-white/15">
                            <p className="m-0 text-sm font-medium text-white truncate">{nombre}</p>
                            <p className="m-0 mb-3 text-xs text-chip truncate">{usuario?.email}</p>
                            <button type="button" className={unir(ITEM, ITEM_INACTIVO)} onClick={salir} disabled={saliendo}>
                                <LogOut size={18} aria-hidden="true" />
                                {saliendo ? 'Cerrando…' : 'Cerrar sesión'}
                            </button>
                        </div>
                    </div>
                </aside>

                <main className={unir('flex-1 min-w-0 overflow-x-auto p-4 pb-28 md:p-8', enDock && 'md:pb-28')}>{children}</main>
            </div>

            <Dock
                enDock={enDock}
                enlaces={enlaces}
                fase={fase}
                alternar={cambiarModo}
                salir={salir}
                saliendo={saliendo}
                refCambio={botonDeCambio}
            />
        </div>
    );
}
