import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { FileText, Plus, ExternalLink, X, UserPlus, AlertCircle, CheckCircle } from 'lucide-react';

const Contratos = () => {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const esPropietario = usuario.rol === 'propietario';
    const [contratos, setContratos] = useState([]);
    const [inmuebles, setInmuebles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    
    // Toast state
    const [toast, setToast] = useState(null);

    // Form state
    const [idInmueble, setIdInmueble] = useState('');
    const [idInquilino, setIdInquilino] = useState('');
    const [fechaInicio, setFechaInicio] = useState('');
    const [fechaFin, setFechaFin] = useState('');
    const [valorMensual, setValorMensual] = useState('');
    const [pdf, setPdf] = useState(null);

    // Tenant Modal state
    const [showTenantModal, setShowTenantModal] = useState(false);
    const [tenantData, setTenantData] = useState({
        nombres: '',
        apellidos: '',
        correo: '',
        telefono: ''
    });

    useEffect(() => {
        fetchData();
    }, []);

    const showNotify = (mensaje, tipo = 'error') => {
        setToast({ mensaje, tipo });
        setTimeout(() => setToast(null), 4000);
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const [contratosRes, inmueblesRes] = await Promise.all([
                api.get('/contratos'),
                api.get('/inmuebles')
            ]);
            setContratos(contratosRes.data);
            setInmuebles(inmueblesRes.data.filter(i => i.estado_ocupacion === 'disponible'));
        } catch (error) {
            showNotify('Error al cargar datos del servidor');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (new Date(fechaFin) <= new Date(fechaInicio)) {
            showNotify('La fecha de fin debe ser posterior a la de inicio');
            return;
        }

        if (parseFloat(valorMensual) <= 0) {
            showNotify('El valor mensual debe ser mayor a cero');
            return;
        }

        const formData = new FormData();
        formData.append('id_inmueble', idInmueble);
        formData.append('id_inquilino', idInquilino);
        formData.append('fecha_inicio', fechaInicio);
        formData.append('fecha_fin', fechaFin);
        formData.append('valor_mensual', valorMensual);
        if (pdf) formData.append('pdf', pdf);

        try {
            await api.post('/contratos', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setShowForm(false);
            resetForm();
            fetchData();
            showNotify('Contrato creado exitosamente', 'success');
        } catch (error) {
            const errorRes = error.response?.data;
            if (error.response?.status === 404 && errorRes?.error_code === 'TENANT_NOT_FOUND') {
                // Si el inquilino no existe (ahora detectado por el código de error), abrimos el modal
                setShowTenantModal(true);
            } else {
                showNotify(errorRes?.mensaje || 'Error al procesar el contrato');
            }
        }
    };

    const handleCreateTenant = async (e) => {
        e.preventDefault();
        try {
            await api.post('/auth/register', {
                ...tenantData,
                documento: idInquilino,
                contrasena: idInquilino, // La cédula es la contraseña inicial
                rol: 'inquilino'
            });
            setShowTenantModal(false);
            showNotify('Inquilino registrado. Ahora puedes crear el contrato.', 'success');
            // Intentamos enviar el contrato de nuevo automáticamente
            handleSubmit({ preventDefault: () => {} });
        } catch (error) {
            showNotify(error.response?.data?.mensaje || 'Error al registrar inquilino');
        }
    };

    const resetForm = () => {
        setIdInmueble('');
        setIdInquilino('');
        setFechaInicio('');
        setFechaFin('');
        setValorMensual('');
        setPdf(null);
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        // Forzamos que la fecha se interprete en UTC para evitar saltos de día por zona horaria
        const date = new Date(dateString);
        return date.toLocaleDateString('es-CO', { timeZone: 'UTC' });
    };

    if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Cargando datos...</div>;

    return (
        <div style={{ position: 'relative' }}>
            {/* Toast System */}
            {toast && (
                <div style={{
                    position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
                    background: toast.tipo === 'success' ? '#059669' : '#ef4444',
                    color: 'white', padding: '1rem 1.5rem', borderRadius: '0.5rem',
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    animation: 'slideIn 0.3s ease-out'
                }}>
                    {toast.tipo === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                    <span style={{ fontWeight: '500' }}>{toast.mensaje}</span>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#1e293b' }}>
                        {esPropietario ? 'Contratos de Arrendamiento' : 'Mi Contrato'}
                    </h2>
                    <p style={{ color: '#64748b' }}>
                        {esPropietario ? 'Gestiona los contratos de tus inmuebles.' : 'Consulta tu contrato vigente.'}
                    </p>
                </div>
                {esPropietario && (
                    <button className="btn btn-primary" onClick={() => setShowForm(!showForm)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {showForm ? <X size={18} /> : <Plus size={18} />}
                        {showForm ? 'Cancelar' : 'Nuevo Contrato'}
                    </button>
                )}
            </div>

            {showForm && (
                <div className="card" style={{ marginBottom: '2rem', border: '1px solid #e2e8f0' }}>
                    <h4 style={{ marginBottom: '1.5rem' }}>Registrar Nuevo Contrato</h4>
                    <form onSubmit={handleSubmit} style={{ maxWidth: '800px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: '500' }}>Inmueble Disponible</label>
                            <select value={idInmueble} onChange={(e) => setIdInmueble(e.target.value)} required>
                                <option value="">-- Seleccione un inmueble --</option>
                                {inmuebles.map(inmueble => (
                                    <option key={inmueble.id_inmueble} value={inmueble.id_inmueble}>
                                        {inmueble.direccion} ({inmueble.barrio})
                                    </option>
                                ))}
                            </select>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: '500' }}>Cédula Inquilino</label>
                            <input type="text" placeholder="Ej: 10203040" value={idInquilino} onChange={(e) => setIdInquilino(e.target.value)} required />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: '500' }}>Fecha Inicio</label>
                            <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} required />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: '500' }}>Fecha Fin</label>
                            <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} required />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: '500' }}>Valor Mensual ($)</label>
                            <input type="number" value={valorMensual} onChange={(e) => setValorMensual(e.target.value)} required />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: '500' }}>PDF del Contrato</label>
                            <input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files[0])} />
                        </div>

                        <div style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '3rem' }}>
                                Crear Contrato
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Inquilino Modal */}
            {showTenantModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 10000, backdropFilter: 'blur(4px)'
                }}>
                    <div className="card" style={{ width: '90%', maxWidth: '450px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#2563eb' }}>
                                <UserPlus size={24} />
                                <h4 style={{ margin: 0 }}>Inquilino No Encontrado</h4>
                            </div>
                            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowTenantModal(false)} />
                        </div>
                        <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                            El inquilino con documento <b>{idInquilino}</b> no está registrado. Por favor completa sus datos para continuar:
                        </p>
                        <form onSubmit={handleCreateTenant}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b' }}>Nombres</label>
                                    <input type="text" value={tenantData.nombres} onChange={(e) => setTenantData({...tenantData, nombres: e.target.value})} required />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b' }}>Apellidos</label>
                                    <input type="text" value={tenantData.apellidos} onChange={(e) => setTenantData({...tenantData, apellidos: e.target.value})} required />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b' }}>Correo Electrónico</label>
                                    <input type="email" value={tenantData.correo} onChange={(e) => setTenantData({...tenantData, correo: e.target.value})} required />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b' }}>Teléfono</label>
                                    <input type="text" value={tenantData.telefono} onChange={(e) => setTenantData({...tenantData, telefono: e.target.value})} required />
                                </div>
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '2rem' }}>
                                Registrar y Continuar
                            </button>
                        </form>
                    </div>
                </div>
            )}

            <div className="card" style={{ border: '1px solid #e2e8f0' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid #f1f5f9', textAlign: 'left' }}>
                                <th style={{ padding: '1rem', color: '#64748b', fontWeight: '600' }}>Inmueble</th>
                                <th style={{ padding: '1rem', color: '#64748b', fontWeight: '600' }}>Inquilino</th>
                                <th style={{ padding: '1rem', color: '#64748b', fontWeight: '600' }}>Vigencia</th>
                                <th style={{ padding: '1rem', color: '#64748b', fontWeight: '600' }}>Valor</th>
                                <th style={{ padding: '1rem', color: '#64748b', fontWeight: '600' }}>Estado</th>
                                {esPropietario && <th style={{ padding: '1rem', color: '#64748b', textAlign: 'center' }}>Acciones</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {contratos.map(contrato => (
                                <tr key={contrato.id_contrato} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: '500' }}>{contrato.Inmueble?.direccion}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{contrato.Inmueble?.municipio}</div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>{contrato.id_inquilino}</td>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontSize: '0.9rem' }}>
                                            {formatDate(contrato.fecha_inicio)} - {formatDate(contrato.fecha_fin)}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1rem', fontWeight: '600', color: '#059669' }}>
                                        ${parseFloat(contrato.valor_mensual).toLocaleString()}
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <span className={`badge ${contrato.estado === 1 ? 'badge-success' : 'badge-pending'}`}>
                                            {contrato.estado === 1 ? 'Activo' : contrato.estado === 2 ? 'Finalizado' : 'Cancelado'}
                                        </span>
                                    </td>
                                    {esPropietario && <td style={{ padding: '1rem', textAlign: 'center', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                        {contrato.url_pdf && (
                                            <a href={`http://localhost:3001${contrato.url_pdf}?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer" className="btn" style={{ color: '#2563eb', padding: '0.4rem' }}>
                                                <ExternalLink size={18} />
                                            </a>
                                        )}
                                        {esPropietario && contrato.estado === 1 && (
                                            <button
                                                title="Finalizar contrato"
                                                onClick={async () => {
                                                    if (!window.confirm('¿Finalizar este contrato?')) return;
                                                    try {
                                                        await api.put(`/contratos/${contrato.id_contrato}/finalizar`);
                                                        showNotify('Contrato finalizado', 'success');
                                                        fetchData();
                                                    } catch (e) {
                                                        showNotify(e.response?.data?.mensaje || 'Error al finalizar');
                                                    }
                                                }}
                                                style={{ border: 'none', background: '#fee2e2', color: '#ef4444', borderRadius: '0.375rem', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                                            >
                                                Finalizar
                                            </button>
                                        )}
                                    </td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default Contratos;