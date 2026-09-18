import { Link } from 'react-router-dom';
import { Building2, Check, KeyRound } from 'lucide-react';

import { unir } from '../../ui/clases';

const VENTAJAS = ['Contratos digitales', 'Control de pagos y mora', 'Dashboard en tiempo real', 'Motor financiero automático'];

/** Enlace de texto de las pantallas de autenticación. */
export const EnlaceAuth = ({ className, ...resto }) => (
    <Link className={unir('text-sm text-indigo-medio no-underline hover:underline', className)} {...resto} />
);

/** Título y bajada de cada pantalla. */
export const Encabezado = ({ titulo, children }) => (
    <header className="mb-6">
        <h1 className="m-0 mb-1 text-2xl font-medium text-texto">{titulo}</h1>
        {children && <p className="m-0 text-sm text-texto-suave">{children}</p>}
    </header>
);

const Logo = () => (
    <div className="flex items-center gap-2.5 mb-8">
        <span className="flex items-center justify-center w-8 h-8 rounded-logo bg-indigo-medio text-white">
            <Building2 size={18} aria-hidden="true" />
        </span>
        <span className="text-lg font-medium text-texto">Arriendos360</span>
    </div>
);

/**
 * Marco de las pantallas públicas y del cambio de contraseña (mockup UI-01):
 * formulario a la izquierda y panel de marca a la derecha, que se oculta en
 * pantallas angostas.
 */
export default function MarcoAuth({ children }) {
    return (
        <div className="box-border min-h-screen flex items-center justify-center bg-lavanda font-sans text-texto p-4">
            <div className="flex flex-col md:flex-row w-full max-w-5xl bg-superficie border border-solid border-borde rounded-app overflow-hidden">
                <main className="box-border flex flex-1 flex-col justify-center px-6 py-10 sm:px-12">
                    <Logo />
                    {children}
                </main>

                <aside className="hidden md:flex flex-1 flex-col justify-center gap-5 bg-indigo-profundo px-12 py-10 text-white">
                    <span className="flex items-center justify-center w-12 h-12 rounded-tarjeta bg-white/15">
                        <KeyRound size={22} aria-hidden="true" />
                    </span>
                    <h2 className="m-0 text-2xl font-medium leading-snug">Gestiona tus arrendamientos de forma inteligente</h2>
                    <p className="m-0 text-sm text-chip">Autogestión de bajo costo que ahorra tiempo y automatiza tus cobros.</p>
                    <ul className="m-0 p-0 list-none flex flex-col gap-2 text-sm text-chip">
                        {VENTAJAS.map((ventaja) => (
                            <li key={ventaja} className="flex items-center gap-2">
                                <Check size={14} aria-hidden="true" className="text-white" />
                                {ventaja}
                            </li>
                        ))}
                    </ul>
                </aside>
            </div>
        </div>
    );
}
