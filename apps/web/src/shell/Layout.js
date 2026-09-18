import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Building2, LogOut, Menu, X } from 'lucide-react';

import { limpiarSesion, useSesion } from '../auth/sesion';
import { cerrarSesion } from '../features/auth/api';
import { FOCO, unir } from '../ui/clases';
import { enlacesPara, etiquetaDeRoles } from './navegacion';

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
 * Armazón de las pantallas autenticadas: barra lateral y contenido.
 *
 * La barra se arma con `roles` del claim (ver `navegacion.js`). En pantallas
 * angostas se pliega bajo un botón de menú.
 */
export default function Layout({ children }) {
    const navigate = useNavigate();
    const { usuario } = useSesion();
    const [menuAbierto, setMenuAbierto] = useState(false);
    const [saliendo, setSaliendo] = useState(false);

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
            <div className="flex flex-col md:flex-row min-h-screen md:min-h-[calc(100vh-2rem)] bg-lavanda md:border md:border-solid md:border-borde md:rounded-app overflow-hidden">
                <aside className="flex flex-col shrink-0 md:w-60 bg-indigo-profundo px-4 py-4 md:py-6">
                    <div className="flex items-center justify-between">
                        <Logo />
                        <button
                            type="button"
                            className={unir('md:hidden flex items-center justify-center w-9 h-9 m-0 p-0 rounded-control border-0 bg-transparent text-white cursor-pointer', FOCO)}
                            aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
                            aria-expanded={menuAbierto}
                            aria-controls="menu-principal"
                            onClick={() => setMenuAbierto((abierto) => !abierto)}
                        >
                            {menuAbierto ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
                        </button>
                    </div>

                    <div
                        id="menu-principal"
                        className={unir(menuAbierto ? 'flex' : 'hidden', 'md:flex flex-col flex-1 mt-4 md:mt-0')}
                    >
                        <p className="m-0 mt-3 mb-6 text-xs font-medium uppercase tracking-label text-chip">
                            {etiquetaDeRoles(usuario)}
                        </p>

                        <nav aria-label="Principal" className="flex flex-col gap-1">
                            {enlaces.map(({ to, etiqueta, icono: Icono, exacto }) => (
                                <NavLink
                                    key={to}
                                    to={to}
                                    end={exacto}
                                    onClick={() => setMenuAbierto(false)}
                                    className={({ isActive }) => unir(ITEM, isActive ? ITEM_ACTIVO : ITEM_INACTIVO)}
                                >
                                    <Icono size={18} aria-hidden="true" />
                                    {etiqueta}
                                </NavLink>
                            ))}
                        </nav>

                        <div className="mt-6 md:mt-auto pt-4 border-0 border-t border-solid border-white/15">
                            <p className="m-0 text-sm font-medium text-white truncate">{nombre}</p>
                            <p className="m-0 mb-3 text-xs text-chip truncate">{usuario?.email}</p>
                            <button type="button" className={unir(ITEM, ITEM_INACTIVO)} onClick={salir} disabled={saliendo}>
                                <LogOut size={18} aria-hidden="true" />
                                {saliendo ? 'Cerrando…' : 'Cerrar sesión'}
                            </button>
                        </div>
                    </div>
                </aside>

                <main className="flex-1 min-w-0 p-4 md:p-8">{children}</main>
            </div>
        </div>
    );
}
