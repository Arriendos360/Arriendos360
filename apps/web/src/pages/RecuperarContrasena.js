import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';

import api from '../services/api';

/**
 * Solicitud de recuperación.
 *
 * La pantalla NO dice si el correo existe: muestra el mismo mensaje siempre,
 * porque el backend responde lo mismo siempre. Si la interfaz distinguiera,
 * daría el dato que la API se cuida de no dar. Ver docs/adr/0010.
 */
const RecuperarContrasena = () => {
    const [email, setEmail] = useState('');
    const [enviado, setEnviado] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setEnviando(true);
        try {
            await api.post('/auth/recuperar', { email });
        } catch {
            // Tampoco un fallo de red cambia lo que se muestra: si el mensaje
            // dependiera de la respuesta, volvería a ser un oráculo.
        } finally {
            setEnviado(true);
            setEnviando(false);
        }
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
            <div style={{ width: '100%', maxWidth: '440px', background: '#fff', padding: '2.5rem', borderRadius: '0.75rem', boxShadow: '0 10px 30px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                    <Mail size={22} color="#2563eb" />
                    <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                        Recuperar contraseña
                    </h2>
                </div>

                {enviado ? (
                    <>
                        <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1rem' }}>
                            Si <b>{email}</b> corresponde a una cuenta, te llegará un enlace para
                            elegir una contraseña nueva. Vale una sola vez y caduca en 30 minutos.
                        </p>
                        <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                            Revisa también la carpeta de correo no deseado.
                        </p>
                    </>
                ) : (
                    <>
                        <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
                            Escribe tu correo y te enviaremos un enlace para elegir una contraseña
                            nueva.
                        </p>

                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '0.35rem' }}>
                                    Correo electrónico
                                </label>
                                <input
                                    type="email"
                                    className="form-control"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoFocus
                                    placeholder="tu@correo.com"
                                />
                            </div>

                            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={enviando}>
                                {enviando ? 'Enviando...' : 'Enviar enlace'}
                            </button>
                        </form>
                    </>
                )}

                <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                    <Link to="/login" style={{ color: '#2563eb', fontSize: '0.85rem', fontWeight: '600', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <ArrowLeft size={14} /> Volver al inicio de sesión
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default RecuperarContrasena;
