import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, AlertCircle, CheckCircle } from 'lucide-react';

import api from '../services/api';

/**
 * Restablecimiento desde el enlace del correo.
 *
 * El token viaja en la query. No se guarda en la sesión ni se reutiliza: se
 * manda una vez y el servidor lo marca como usado.
 *
 * Al terminar NO se entra automáticamente: hay que iniciar sesión. Darle sesión
 * aquí convertiría el enlace del correo en un acceso directo a la cuenta.
 */
const RestablecerContrasena = () => {
    const navigate = useNavigate();
    const [parametros] = useSearchParams();
    const token = parametros.get('token');

    const [nueva, setNueva] = useState('');
    const [confirmar, setConfirmar] = useState('');
    const [error, setError] = useState('');
    const [listo, setListo] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (nueva !== confirmar) {
            setError('Las contraseñas no coinciden');
            return;
        }
        if (nueva.length < 8) {
            setError('La contraseña debe tener al menos 8 caracteres');
            return;
        }

        setEnviando(true);
        try {
            await api.post('/auth/restablecer', { token, contrasena_nueva: nueva });
            setListo(true);
        } catch (err) {
            setError(err.response?.data?.mensaje || 'No se pudo restablecer la contraseña');
        } finally {
            setEnviando(false);
        }
    };

    const marco = (contenido) => (
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
            <div style={{ width: '100%', maxWidth: '440px', background: '#fff', padding: '2.5rem', borderRadius: '0.75rem', boxShadow: '0 10px 30px rgba(0,0,0,0.06)' }}>
                {contenido}
                <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                    <Link to="/login" style={{ color: '#2563eb', fontSize: '0.85rem', fontWeight: '600', textDecoration: 'none' }}>
                        Ir al inicio de sesión
                    </Link>
                </div>
            </div>
        </div>
    );

    if (!token) {
        return marco(
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#b91c1c' }}>
                <AlertCircle size={20} />
                <span style={{ fontSize: '0.9rem' }}>
                    El enlace está incompleto. Pide uno nuevo desde «Recuperar contraseña».
                </span>
            </div>
        );
    }

    if (listo) {
        return marco(
            <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                    <CheckCircle size={22} color="#16a34a" />
                    <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                        Contraseña restablecida
                    </h2>
                </div>
                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                    Se cerraron todas las sesiones que estuvieran abiertas con tu cuenta. Inicia
                    sesión con tu contraseña nueva.
                </p>
                <button
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: '1.5rem' }}
                    onClick={() => navigate('/login')}
                >
                    Iniciar sesión
                </button>
            </>
        );
    }

    return marco(
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                <KeyRound size={22} color="#2563eb" />
                <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                    Elige una contraseña nueva
                </h2>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
                Al guardarla se cerrarán todas las sesiones abiertas con tu cuenta.
            </p>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#fef2f2', color: '#b91c1c', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.35rem' }}>
                        Contraseña nueva
                    </label>
                    <input type="password" className="form-control" value={nueva}
                        onChange={(e) => setNueva(e.target.value)} required minLength={8} autoFocus />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.35rem' }}>
                        Repite la contraseña
                    </label>
                    <input type="password" className="form-control" value={confirmar}
                        onChange={(e) => setConfirmar(e.target.value)} required />
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={enviando}>
                    {enviando ? 'Guardando...' : 'Guardar contraseña'}
                </button>
            </form>
        </>
    );
};

export default RestablecerContrasena;
