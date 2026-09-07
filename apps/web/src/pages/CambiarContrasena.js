import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, AlertCircle } from 'lucide-react';

import { guardarSesion, useSesion } from '../auth/sesion';
import api from '../services/api';

/**
 * Cambio de contraseña.
 *
 * Es la única pantalla accesible para quien entró con una contraseña temporal:
 * el guardián de ruta lo trae aquí y la API le deniega todo lo demás con
 * `CAMBIO_CONTRASENA_REQUERIDO`. Ver docs/adr/0007.
 *
 * También sirve para cambiarla voluntariamente, y en ese caso el texto de la
 * cabecera se adapta en vez de hablar de una temporal que no existe.
 */
const CambiarContrasena = () => {
    const navigate = useNavigate();
    const { debeCambiar, usuario } = useSesion();

    const [actual, setActual] = useState('');
    const [nueva, setNueva] = useState('');
    const [confirmar, setConfirmar] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (nueva !== confirmar) {
            setError('Las contraseñas nuevas no coinciden');
            return;
        }
        if (nueva.length < 8) {
            setError('La contraseña nueva debe tener al menos 8 caracteres');
            return;
        }
        if (nueva === actual) {
            setError('La contraseña nueva debe ser distinta de la actual');
            return;
        }

        setEnviando(true);
        try {
            const respuesta = await api.post('/auth/cambiar-contrasena', {
                contrasena_actual: actual,
                contrasena_nueva: nueva
            });

            // El servicio revoca el token viejo y emite otro: el viejo todavía
            // afirmaba que había que cambiar la contraseña.
            guardarSesion({
                token: respuesta.data.token,
                usuario: respuesta.data.usuario
            });

            navigate('/');
        } catch (err) {
            setError(err.response?.data?.mensaje || 'No se pudo cambiar la contraseña');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
            <div style={{ width: '100%', maxWidth: '440px', background: '#fff', padding: '2.5rem', borderRadius: '0.75rem', boxShadow: '0 10px 30px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                    <KeyRound size={22} color="#2563eb" />
                    <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                        {debeCambiar ? 'Elige tu contraseña' : 'Cambiar contraseña'}
                    </h2>
                </div>

                {debeCambiar ? (
                    <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
                        Entraste con una contraseña temporal que te entregó tu arrendador.
                        Elige una propia para continuar; hasta entonces no podrás usar el resto
                        de la aplicación.
                    </p>
                ) : (
                    <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
                        Se cerrará esta sesión y se abrirá una nueva.
                    </p>
                )}

                {error && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#fef2f2', color: '#b91c1c', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.35rem' }}>
                            {debeCambiar ? 'Contraseña temporal' : 'Contraseña actual'}
                        </label>
                        <input
                            type="password"
                            className="form-control"
                            value={actual}
                            onChange={(e) => setActual(e.target.value)}
                            required
                            autoFocus
                        />
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.35rem' }}>
                            Contraseña nueva
                        </label>
                        <input
                            type="password"
                            className="form-control"
                            value={nueva}
                            onChange={(e) => setNueva(e.target.value)}
                            required
                            minLength={8}
                        />
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.35rem' }}>
                            Repite la contraseña nueva
                        </label>
                        <input
                            type="password"
                            className="form-control"
                            value={confirmar}
                            onChange={(e) => setConfirmar(e.target.value)}
                            required
                        />
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={enviando}>
                        {enviando ? 'Guardando...' : 'Guardar contraseña'}
                    </button>
                </form>

                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '1.25rem', textAlign: 'center' }}>
                    Sesión de {usuario?.email}
                </p>
            </div>
        </div>
    );
};

export default CambiarContrasena;
