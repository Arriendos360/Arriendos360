import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

import { unir } from '../../ui/clases';

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

/** Marco de las pantallas públicas y del cambio de contraseña: una tarjeta centrada con el formulario. */
export default function MarcoAuth({ children }) {
    return (
        <div className="box-border min-h-screen flex items-center justify-center bg-lavanda font-sans text-texto p-4">
            <main className="box-border w-full max-w-lg px-6 py-10 sm:px-12 bg-superficie border border-solid border-borde rounded-app">
                <Logo />
                {children}
            </main>
        </div>
    );
}
