import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button, FormError, PasswordField } from '../../ui';
import { restablecerContrasena } from './api';
import MarcoAuth, { EnlaceAuth, Encabezado } from './MarcoAuth';
import { LONGITUD_MINIMA, validarContrasenaNueva } from './reglas';

/**
 * Restablecimiento desde el enlace del correo.
 *
 * El token viaja en la query. No se guarda en la sesión ni se reutiliza: se
 * manda una vez y el servidor lo marca como usado.
 *
 * Al terminar NO se entra automáticamente: hay que iniciar sesión. Darle sesión
 * aquí convertiría el enlace del correo en un acceso directo a la cuenta.
 */
export default function RestablecerContrasena() {
    const navigate = useNavigate();
    const [parametros] = useSearchParams();
    const token = parametros.get('token');

    const [nueva, setNueva] = useState('');
    const [confirmar, setConfirmar] = useState('');
    const [error, setError] = useState(null);
    const [listo, setListo] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const guardar = async (evento) => {
        evento.preventDefault();
        const invalida = validarContrasenaNueva({ nueva, confirmar });
        if (invalida) {
            setError(invalida);
            return;
        }
        setError(null);
        setEnviando(true);
        try {
            await restablecerContrasena({ token, contrasena_nueva: nueva });
            setListo(true);
        } catch (err) {
            setError(err);
        } finally {
            setEnviando(false);
        }
    };

    let contenido;
    if (!token) {
        contenido = (
            <>
                <Encabezado titulo="Enlace incompleto" />
                <FormError error="El enlace está incompleto. Pide uno nuevo desde «Recuperar contraseña»." className="mb-6" />
                <EnlaceAuth to="/recuperar" className="self-center">Recuperar contraseña</EnlaceAuth>
            </>
        );
    } else if (listo) {
        contenido = (
            <>
                <Encabezado titulo="Contraseña restablecida">
                    Se cerraron todas las sesiones que estuvieran abiertas con tu cuenta. Inicia sesión con tu
                    contraseña nueva.
                </Encabezado>
                <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>Iniciar sesión</Button>
            </>
        );
    } else {
        contenido = (
            <>
                <Encabezado titulo="Elige una contraseña nueva">
                    Al guardarla se cerrarán todas las sesiones abiertas con tu cuenta.
                </Encabezado>
                <form onSubmit={guardar} className="flex flex-col gap-4 mb-6">
                    <FormError error={error} />
                    <PasswordField
                        etiqueta="Contraseña nueva"
                        autoComplete="new-password"
                        required
                        autoFocus
                        minLength={LONGITUD_MINIMA}
                        ayuda={`Mínimo ${LONGITUD_MINIMA} caracteres.`}
                        value={nueva}
                        onChange={(e) => setNueva(e.target.value)}
                    />
                    <PasswordField
                        etiqueta="Repite la contraseña"
                        autoComplete="new-password"
                        required
                        value={confirmar}
                        onChange={(e) => setConfirmar(e.target.value)}
                    />
                    <Button type="submit" cargando={enviando} className="w-full">Guardar contraseña</Button>
                </form>
                <EnlaceAuth to="/login" className="self-center">Ir al inicio de sesión</EnlaceAuth>
            </>
        );
    }

    return <MarcoAuth>{contenido}</MarcoAuth>;
}
