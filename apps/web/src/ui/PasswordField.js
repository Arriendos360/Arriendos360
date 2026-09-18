import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import Campo from './Campo';
import { CONTROL, CONTROL_CON_ERROR, FOCO, unir } from './clases';

/** Campo de contraseña con botón para mostrarla u ocultarla. */
export default function PasswordField({ etiqueta, ayuda, error, id, className, ...resto }) {
    const [visible, setVisible] = useState(false);

    return (
        <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} id={id} className={className}>
            {(enlace) => (
                <div className="relative">
                    <input
                        {...enlace}
                        {...resto}
                        type={visible ? 'text' : 'password'}
                        className={unir(CONTROL, 'pr-10', error && CONTROL_CON_ERROR)}
                    />
                    <button
                        type="button"
                        onClick={() => setVisible((antes) => !antes)}
                        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        aria-pressed={visible}
                        className={unir(
                            'absolute inset-y-0 right-0 flex items-center justify-center w-10 m-0 p-0',
                            'border-0 bg-transparent text-texto-suave cursor-pointer rounded-control',
                            FOCO
                        )}
                    >
                        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                </div>
            )}
        </Campo>
    );
}
