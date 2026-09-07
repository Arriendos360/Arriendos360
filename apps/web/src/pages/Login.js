import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const Login = () => {
    const [modo, setModo] = useState('login'); // 'login' | 'registro'
    const navigate = useNavigate();

    // Login
    const [correo, setCorreo] = useState('');
    const [contrasena, setContrasena] = useState('');
    const [error, setError] = useState('');

    // Registro
    const [regData, setRegData] = useState({
        nombres: '', apellidos: '', documento: '',
        correo: '', telefono: '', contrasena: '', confirmar: ''
    });
    const [regError, setRegError] = useState('');
    const [regExito, setRegExito] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const response = await api.post('/auth/login', { correo, contrasena });
            localStorage.setItem('token', response.data.token);
            localStorage.setItem('usuario', JSON.stringify(response.data.usuario));
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.mensaje || 'Correo o contraseña incorrectos');
        }
    };

    const handleRegistro = async (e) => {
        e.preventDefault();
        setRegError('');
        if (regData.contrasena !== regData.confirmar) {
            setRegError('Las contraseñas no coinciden');
            return;
        }
        if (regData.contrasena.length < 6) {
            setRegError('La contraseña debe tener al menos 6 caracteres');
            return;
        }
        try {
            await api.post('/auth/register', {
                nombres: regData.nombres,
                apellidos: regData.apellidos,
                documento: regData.documento,
                correo: regData.correo,
                telefono: regData.telefono,
                contrasena: regData.contrasena,
                rol: 'propietario'
            });
            setRegExito(true);
        } catch (err) {
            setRegError(err.response?.data?.mensaje || 'Error al registrarse');
        }
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh' }}>

            {/* Panel izquierdo — formulario (como RentRoll) */}
            <div style={{
                width: '100%', maxWidth: '520px', background: '#fff',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                padding: '3rem 3.5rem', boxShadow: '4px 0 32px rgba(0,0,0,0.06)'
            }}>
                {/* Logo */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '2.5rem' }}>
                    <img src="/Logo.png" alt="Logo" style={{ width: '38px', height: '38px', objectFit: 'contain' }} />
                    <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>Arriendos360</span>
                </div>

                {/* Toggle — solo propietarios se registran */}
                <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '0.75rem', padding: '0.25rem', marginBottom: '1.5rem' }}>
                    {[
                        { key: 'login',    label: 'Iniciar sesión' },
                        { key: 'registro', label: 'Soy propietario' },
                    ].map(m => (
                        <button key={m.key} onClick={() => { setModo(m.key); setError(''); setRegError(''); setRegExito(false); }}
                            style={{
                                flex: 1, padding: '0.6rem', border: 'none', borderRadius: '0.5rem', cursor: 'pointer',
                                fontWeight: '600', fontSize: '0.9rem', transition: 'all 0.2s',
                                background: modo === m.key ? '#fff' : 'transparent',
                                color: modo === m.key ? '#2563eb' : '#64748b',
                                boxShadow: modo === m.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none'
                            }}>
                            {m.label}
                        </button>
                    ))}
                </div>

                {/* Info para inquilinos */}
                {modo === 'login' && (
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '0.875rem 1rem', marginBottom: '1.5rem' }}>
                        <p style={{ fontSize: '0.8rem', fontWeight: '700', color: '#475569', marginBottom: '0.25rem' }}>👤 ¿Eres inquilino?</p>
                        <p style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                            Solicita tus credenciales de acceso a tu arrendador.
                        </p>
                    </div>
                )}

                {/* LOGIN */}
                {modo === 'login' && (
                    <>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.5rem' }}>Bienvenido de nuevo</h2>
                        <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: '0.9rem' }}>Ingresa tus credenciales para continuar</p>

                        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>}

                        <form onSubmit={handleLogin} style={{ maxWidth: 'none', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <div>
                                <label style={{ fontSize: '0.875rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.4rem' }}>Correo Electrónico</label>
                                <input type="email" value={correo} onChange={e => setCorreo(e.target.value)} required
                                    placeholder="tu@correo.com"
                                    style={{ width: '100%', padding: '0.65rem 0.875rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.875rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.4rem' }}>Contraseña</label>
                                <input type="password" value={contrasena} onChange={e => setContrasena(e.target.value)} required
                                    placeholder="••••••••"
                                    style={{ width: '100%', padding: '0.65rem 0.875rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <button type="submit" style={{
                                width: '100%', padding: '0.75rem',
                                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                                color: '#fff', border: 'none', borderRadius: '0.5rem',
                                fontWeight: '600', fontSize: '1rem', cursor: 'pointer',
                                boxShadow: '0 4px 12px rgba(37,99,235,0.3)'
                            }}>
                                Ingresar
                            </button>
                        </form>

                        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.875rem', color: '#64748b' }}>
                            ¿Eres propietario y no tienes cuenta?{' '}
                            <button onClick={() => setModo('registro')} style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: '600', cursor: 'pointer' }}>
                                Regístrate aquí
                            </button>
                        </p>
                    </>
                )}

                {/* REGISTRO */}
                {modo === 'registro' && (
                    <>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.5rem' }}>Crear cuenta</h2>
                        <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: '0.9rem' }}>Regístrate como propietario para gestionar tus inmuebles</p>

                        {regExito ? (
                            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                                <h3 style={{ color: '#166534', marginBottom: '0.5rem' }}>¡Cuenta creada!</h3>
                                <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: '0.9rem' }}>Ya puedes iniciar sesión con tu correo y contraseña.</p>
                                <button onClick={() => { setModo('login'); setRegExito(false); }}
                                    style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.65rem 1.5rem', fontWeight: '600', cursor: 'pointer' }}>
                                    Ir al inicio de sesión
                                </button>
                            </div>
                        ) : (
                            <>
                                {regError && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>{regError}</div>}
                                <form onSubmit={handleRegistro} style={{ maxWidth: 'none', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.3rem' }}>Nombres</label>
                                            <input value={regData.nombres} onChange={e => setRegData({...regData, nombres: e.target.value})} required placeholder="Juan"
                                                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.3rem' }}>Apellidos</label>
                                            <input value={regData.apellidos} onChange={e => setRegData({...regData, apellidos: e.target.value})} required placeholder="Pérez"
                                                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.3rem' }}>Cédula</label>
                                            <input value={regData.documento} onChange={e => setRegData({...regData, documento: e.target.value})} required placeholder="10203040"
                                                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.3rem' }}>Teléfono</label>
                                            <input value={regData.telefono} onChange={e => setRegData({...regData, telefono: e.target.value})} placeholder="3001234567"
                                                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.3rem' }}>Correo Electrónico</label>
                                        <input type="email" value={regData.correo} onChange={e => setRegData({...regData, correo: e.target.value})} required placeholder="tu@correo.com"
                                            style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.3rem' }}>Contraseña</label>
                                            <input type="password" value={regData.contrasena} onChange={e => setRegData({...regData, contrasena: e.target.value})} required placeholder="Min. 6 caracteres"
                                                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.3rem' }}>Confirmar</label>
                                            <input type="password" value={regData.confirmar} onChange={e => setRegData({...regData, confirmar: e.target.value})} required placeholder="Repite la contraseña"
                                                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1.5px solid #e2e8f0', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                        </div>
                                    </div>
                                    <button type="submit" style={{
                                        width: '100%', padding: '0.75rem', marginTop: '0.5rem',
                                        background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                                        color: '#fff', border: 'none', borderRadius: '0.5rem',
                                        fontWeight: '600', fontSize: '1rem', cursor: 'pointer',
                                        boxShadow: '0 4px 12px rgba(37,99,235,0.3)'
                                    }}>
                                        Crear cuenta
                                    </button>
                                </form>
                            </>
                        )}
                    </>
                )}
            </div>

            {/* Panel derecho — foto edificio */}
            <div style={{
                flex: 1,
                backgroundImage: 'url(/edificio.png)',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                position: 'relative',
                display: 'flex',
                alignItems: 'flex-end',
            }}>
                {/* Overlay oscuro */}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.2) 60%, transparent 100%)' }} />
                {/* Texto sobre la foto */}
                <div style={{ position: 'relative', padding: '2.5rem', color: '#fff' }}>
                    <p style={{ fontSize: '1.5rem', fontWeight: '800', lineHeight: 1.3, marginBottom: '0.75rem' }}>
                        Gestiona tus arrendamientos<br />de forma inteligente
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {['Contratos digitales', 'Control de pagos y mora', 'Dashboard en tiempo real', 'Motor financiero automático'].map((f, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', opacity: 0.9 }}>
                                <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', flexShrink: 0 }}>✓</div>
                                <span style={{ fontSize: '0.9rem' }}>{f}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
