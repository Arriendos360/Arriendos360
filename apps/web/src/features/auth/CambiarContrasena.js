import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { guardarSesion, limpiarSesion, useSesion } from '../../auth/sesion';
import { Button, FormError, PasswordField } from '../../ui';
import { cambiarContrasena, cerrarSesion } from './api';
import MarcoAuth, { Encabezado } from './MarcoAuth';
import { LONGITUD_MINIMA, validarContrasenaNueva } from './reglas';

/**
 * Cambio de contraseña.
 *
 * Es la única pantalla accesible para quien entró con una contraseña temporal:
 * el guardián de ruta lo trae aquí y la API le deniega todo lo demás con
 * `CAMBIO_CONTRASENA_REQUERIDO`. Ver docs/adr/0007.
 *
 * También sirve para cambiarla voluntariamente, y en ese caso el texto se
 * adapta en vez de hablar de una temporal que no existe.
 */
export default function CambiarContrasena() {
    const navigate = useNavigate();
    const { debeCambiar, usuario } = useSesion();

    const [actual, setActual] = useState('');
    const [nueva, setNueva] = useState('');
    const [confirmar, setConfirmar] = useState('');
    const [error, setError] = useState(null);
    const [enviando, setEnviando] = useState(false);

    const guardar = async (evento) => {
        evento.preventDefault();
        const invalida = validarContrasenaNueva({ nueva, confirmar, actual });
        if (invalida) {
            setError(invalida);
            return;
        }
        setError(null);
        setEnviando(true);
        try {
            const respuesta = await cambiarContrasena({ contrasena_actual: actual, contrasena_nueva: nueva });
            // El servicio revoca el token viejo y emite otro: el viejo todavía
            // afirmaba que había que cambiar la contraseña.
            guardarSesion({ token: respuesta.token, usuario: respuesta.usuario });
            navigate('/', { replace: true });
        } catch (err) {
            setError(err);
            setEnviando(false);
        }
    };

    // Salida para quien no quiere cambiarla ahora: sin esto, la única forma de
    // dejar esta pantalla con una temporal sería recargar la página.
    const salir = async () => {
        try {
            await cerrarSesion();
        } catch {
            // Se cierra igual en el cliente, como en el shell.
        } finally {
            limpiarSesion();
            navigate('/login', { replace: true });
        }
    };

    return (
        <MarcoAuth>
            {debeCambiar ? (
                <Encabezado titulo="Elige tu contraseña">
                    Entraste con una contraseña temporal que te entregó tu arrendador. Elige una propia para
                    continuar; hasta entonces no podrás usar el resto de la aplicación.
                </Encabezado>
            ) : (
                <Encabezado titulo="Cambiar contraseña">Se cerrará esta sesión y se abrirá una nueva.</Encabezado>
            )}

            <form onSubmit={guardar} className="flex flex-col gap-4">
                <FormError error={error} />
                <PasswordField
                    etiqueta={debeCambiar ? 'Contraseña temporal' : 'Contraseña actual'}
                    autoComplete="current-password"
                    required
                    autoFocus
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                />
                <PasswordField
                    etiqueta="Contraseña nueva"
                    autoComplete="new-password"
                    required
                    minLength={LONGITUD_MINIMA}
                    ayuda={`Mínimo ${LONGITUD_MINIMA} caracteres, distinta de la ${debeCambiar ? 'temporal' : 'actual'}.`}
                    value={nueva}
                    onChange={(e) => setNueva(e.target.value)}
                />
                <PasswordField
                    etiqueta="Repite la contraseña nueva"
                    autoComplete="new-password"
                    required
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                />
                <Button type="submit" cargando={enviando} className="w-full">Guardar contraseña</Button>
            </form>

            <div className="flex items-center justify-between gap-3 mt-6 text-xs text-texto-suave">
                <span className="truncate">Sesión de {usuario?.email}</span>
                <Button variante="fantasma" tamano="pequeno" onClick={salir}>Cerrar sesión</Button>
            </div>
        </MarcoAuth>
    );
}
