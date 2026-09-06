import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Plus, Home as HomeIcon, X, MapPin, Pencil, Trash2, User, Calendar, ChevronDown, ChevronUp, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { colombiaData } from '../data/colombia';

const FORM_VACIO = {
    direccion: '', departamento: '', municipio: '', barrio: '',
    tipo_inmueble: 'Apartamento', area_m2: '', estrato: 3,
    habitaciones: 2, banos: 1, deposito: 0, parqueaderos: 0,
    precio: '', estado_ocupacion: 'disponible'
};

const estadoPagoConfig = {
    2: { label: 'Pagado',       color: '#15803d', bg: '#dcfce7', icon: <CheckCircle size={13} /> },
    1: { label: 'Pendiente',    color: '#a16207', bg: '#fef9c3', icon: <Clock size={13} /> },
    4: { label: 'Pago Parcial', color: '#a16207', bg: '#fef9c3', icon: <Clock size={13} /> },
    3: { label: 'En Mora',      color: '#b91c1c', bg: '#fee2e2', icon: <AlertTriangle size={13} /> },
};

const Inmuebles = () => {
    const [inmuebles, setInmuebles]   = useState([]);
    const [contratos, setContratos]   = useState([]);
    const [pagos, setPagos]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [showModal, setShowModal]   = useState(false);
    const [editando, setEditando]     = useState(null);
    const [expandido, setExpandido]   = useState(null);
    const [formData, setFormData]     = useState(FORM_VACIO);

    const fetchData = async () => {
        try {
            const [inm, con, pag] = await Promise.all([
                api.get('/inmuebles'),
                api.get('/contratos'),
                api.get('/pagos'),
            ]);
            setInmuebles(inm.data);
            setContratos(con.data);
            setPagos(pag.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name === 'departamento') setFormData({ ...formData, [name]: value, municipio: '' });
        else setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editando) await api.put(`/inmuebles/${editando}`, formData);
            else          await api.post('/inmuebles', formData);
            setShowModal(false); setEditando(null); setFormData(FORM_VACIO);
            fetchData();
        } catch (err) {
            alert('Error: ' + (err.response?.data?.mensaje || err.message));
        }
    };

    const handleEditar = (inm) => {
        setEditando(inm.id_inmueble);
        setFormData({
            direccion: inm.direccion || '', departamento: inm.departamento || '',
            municipio: inm.municipio || '', barrio: inm.barrio || '',
            tipo_inmueble: inm.tipo_inmueble || 'Apartamento', area_m2: inm.area_m2 || '',
            estrato: inm.estrato || 3, habitaciones: inm.habitaciones || 2,
            banos: inm.banos || 1, deposito: inm.deposito || 0,
            parqueaderos: inm.parqueaderos || 0, precio: '', estado_ocupacion: inm.estado_ocupacion || 'disponible'
        });
        setShowModal(true);
    };

    const handleEliminar = async (id) => {
        if (!window.confirm('¿Eliminar este inmueble?')) return;
        try { await api.delete(`/inmuebles/${id}`); fetchData(); }
        catch (err) { alert('Error: ' + (err.response?.data?.mensaje || err.message)); }
    };

    const getContratoActivo = (id_inmueble) =>
        contratos.find(c => c.id_inmueble === id_inmueble && c.estado === 1);

    const getUltimoPago = (id_contrato) =>
        pagos
            .filter(p => p.id_contrato === id_contrato)
            .sort((a, b) => new Date(b.mes_correspondiente) - new Date(a.mes_correspondiente))[0];

    if (loading) return <div className="loading">Cargando inmuebles...</div>;

    const disponibles  = inmuebles.filter(i => i.estado_ocupacion === 'disponible').length;
    const arrendados   = inmuebles.filter(i => i.estado_ocupacion !== 'disponible').length;

    return (
        <div className="fade-in">

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.875rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>Mis Inmuebles</h2>
                    <p style={{ color: '#64748b', marginTop: '0.25rem' }}>Gestiona tus propiedades y sus contratos de arrendamiento.</p>
                </div>
                <button className="btn btn-primary" onClick={() => { setEditando(null); setFormData(FORM_VACIO); setShowModal(true); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem' }}>
                    <Plus size={18} /> Registrar Propiedad
                </button>
            </div>

            {/* Mini KPIs */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                {[
                    { label: 'Total propiedades', value: inmuebles.length, color: '#2563eb', bg: '#dbeafe' },
                    { label: 'Arrendadas',         value: arrendados,       color: '#15803d', bg: '#dcfce7' },
                    { label: 'Disponibles',        value: disponibles,      color: '#92400e', bg: '#fef3c7' },
                ].map((k, i) => (
                    <div key={i} style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.875rem', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</p>
                            <p style={{ fontSize: '1.75rem', fontWeight: '800', color: k.color, marginTop: '0.1rem' }}>{k.value}</p>
                        </div>
                        <div style={{ background: k.bg, padding: '0.6rem', borderRadius: '0.6rem' }}>
                            <HomeIcon size={22} color={k.color} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Sin inmuebles */}
            {inmuebles.length === 0 && (
                <div style={{ textAlign: 'center', padding: '4rem', background: '#fff', borderRadius: '1rem', border: '1px dashed #e2e8f0' }}>
                    <HomeIcon size={48} color="#cbd5e1" style={{ margin: '0 auto 1rem' }} />
                    <p style={{ color: '#64748b' }}>No tienes inmuebles registrados todavía.</p>
                </div>
            )}

            {/* Lista de inmuebles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {inmuebles.map((inm) => {
                    const contrato    = getContratoActivo(inm.id_inmueble);
                    const ultimoPago  = contrato ? getUltimoPago(contrato.id_contrato) : null;
                    const estadoPago  = ultimoPago ? estadoPagoConfig[ultimoPago.estado] : null;
                    const abierto     = expandido === inm.id_inmueble;
                    const disponible  = inm.estado_ocupacion === 'disponible';

                    return (
                        <div key={inm.id_inmueble} style={{
                            background: '#fff', borderRadius: '1rem',
                            border: '1px solid #e2e8f0', overflow: 'hidden',
                            boxShadow: abierto ? '0 4px 24px rgba(37,99,235,0.1)' : '0 1px 4px rgba(0,0,0,0.04)',
                            transition: 'box-shadow 0.2s'
                        }}>
                            {/* Fila principal — clickeable */}
                            <div
                                onClick={() => setExpandido(abierto ? null : inm.id_inmueble)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '1rem',
                                    padding: '1rem 1.25rem', cursor: 'pointer',
                                    borderBottom: abierto ? '1px solid #f1f5f9' : 'none'
                                }}>

                                {/* Icono estado */}
                                <div style={{
                                    width: '44px', height: '44px', flexShrink: 0, borderRadius: '0.75rem',
                                    background: disponible ? '#dbeafe' : '#dcfce7',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                    <HomeIcon size={22} color={disponible ? '#2563eb' : '#15803d'} />
                                </div>

                                {/* Dirección */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {inm.direccion}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.1rem' }}>
                                        <MapPin size={11} />
                                        {[inm.barrio, inm.municipio].filter(Boolean).join(', ')}
                                        {inm.tipo_inmueble && <span style={{ marginLeft: '0.25rem' }}>· {inm.tipo_inmueble}</span>}
                                        {inm.estrato && <span>· E{inm.estrato}</span>}
                                    </div>
                                </div>

                                {/* Specs rápidos */}
                                <div style={{ display: 'flex', gap: '1.25rem', flexShrink: 0 }}>
                                    {[
                                        { l: 'Hab.', v: inm.habitaciones },
                                        { l: 'Baños', v: inm.banos },
                                        inm.area_m2 ? { l: 'Área', v: `${inm.area_m2}m²` } : null,
                                    ].filter(Boolean).map((s, i) => (
                                        <div key={i} style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>{s.l}</div>
                                            <div style={{ fontWeight: '700', fontSize: '0.9rem', color: '#475569' }}>{s.v ?? '--'}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Canon (si tiene contrato) */}
                                {contrato && (
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>Canon/mes</div>
                                        <div style={{ fontWeight: '800', fontSize: '1rem', color: '#0f172a' }}>
                                            ${parseFloat(contrato.valor_mensual).toLocaleString()}
                                        </div>
                                    </div>
                                )}

                                {/* Estado pago */}
                                {estadoPago ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: estadoPago.bg, color: estadoPago.color, padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '700', flexShrink: 0 }}>
                                        {estadoPago.icon} {estadoPago.label}
                                    </div>
                                ) : (
                                    <span style={{ background: '#f1f5f9', color: '#94a3b8', padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '600', flexShrink: 0 }}>
                                        {disponible ? 'Disponible' : 'Sin cobro'}
                                    </span>
                                )}

                                {/* Acciones */}
                                <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                    <button onClick={() => handleEditar(inm)} title="Editar"
                                        style={{ border: 'none', background: '#eff6ff', color: '#2563eb', borderRadius: '0.5rem', padding: '0.4rem 0.55rem', cursor: 'pointer' }}>
                                        <Pencil size={15} />
                                    </button>
                                    <button onClick={() => handleEliminar(inm.id_inmueble)} title="Eliminar"
                                        style={{ border: 'none', background: '#fee2e2', color: '#ef4444', borderRadius: '0.5rem', padding: '0.4rem 0.55rem', cursor: 'pointer' }}>
                                        <Trash2 size={15} />
                                    </button>
                                </div>

                                {/* Chevron */}
                                <div style={{ color: '#cbd5e1', flexShrink: 0 }}>
                                    {abierto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                </div>
                            </div>

                            {/* Panel expandido — detalle del contrato */}
                            {abierto && (
                                <div style={{ padding: '1.25rem', background: '#f8fafc', display: 'grid', gridTemplateColumns: contrato ? '1fr 1fr' : '1fr', gap: '1rem', animation: 'fadeIn 0.2s ease' }}>
                                    {contrato ? (
                                        <>
                                            {/* Info contrato */}
                                            <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1rem', border: '1px solid #e2e8f0' }}>
                                                <p style={{ fontSize: '0.7rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Contrato Activo</p>
                                                {[
                                                    { icon: <User size={13} />,      label: 'Inquilino',   value: contrato.id_inquilino },
                                                    { icon: <Calendar size={13} />,  label: 'Inicio',      value: new Date(contrato.fecha_inicio).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) },
                                                    { icon: <Calendar size={13} />,  label: 'Vencimiento', value: new Date(contrato.fecha_fin).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) },
                                                ].map((r, i) => (
                                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: i < 2 ? '1px solid #f1f5f9' : 'none' }}>
                                                        <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>{r.icon}{r.label}</span>
                                                        <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#0f172a' }}>{r.value}</span>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Último cobro */}
                                            <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1rem', border: '1px solid #e2e8f0' }}>
                                                <p style={{ fontSize: '0.7rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Último Cobro</p>
                                                {ultimoPago ? (
                                                    <>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #f1f5f9' }}>
                                                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Mes</span>
                                                            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#0f172a' }}>
                                                                {new Date(ultimoPago.mes_correspondiente).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #f1f5f9' }}>
                                                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Monto</span>
                                                            <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#0f172a' }}>${parseFloat(ultimoPago.monto_total).toLocaleString()}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0' }}>
                                                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Saldo pendiente</span>
                                                            <span style={{ fontSize: '0.8rem', fontWeight: '700', color: parseFloat(ultimoPago.saldo_pendiente) > 0 ? '#ef4444' : '#15803d' }}>
                                                                ${parseFloat(ultimoPago.saldo_pendiente).toLocaleString()}
                                                            </span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <p style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>Sin cobros registrados</p>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8' }}>
                                            <p style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Sin contrato activo</p>
                                            <p style={{ fontSize: '0.85rem' }}>Este inmueble está disponible para arrendar.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Modal crear/editar */}
            {showModal && (
                <div className="modal-overlay">
                    <div className="card modal-content" style={{ width: '95%', maxWidth: '600px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>{editando ? 'Editar Propiedad' : 'Registrar Nueva Propiedad'}</h3>
                                <p style={{ fontSize: '0.8rem', color: '#64748b' }}>Completa los datos del inmueble.</p>
                            </div>
                            <button className="btn-icon" onClick={() => { setShowModal(false); setEditando(null); }}><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label className="form-label">Dirección Exacta</label>
                                    <input className="form-control" name="direccion" placeholder="Ej: Calle 10 # 45-20" value={formData.direccion} onChange={handleChange} required />
                                </div>
                                <div>
                                    <label className="form-label">Departamento</label>
                                    <select className="form-control" name="departamento" value={formData.departamento} onChange={handleChange}>
                                        <option value="">-- Seleccione --</option>
                                        {Object.keys(colombiaData).map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="form-label">Municipio</label>
                                    <select className="form-control" name="municipio" value={formData.municipio} onChange={handleChange} disabled={!formData.departamento}>
                                        <option value="">-- Seleccione --</option>
                                        {(colombiaData[formData.departamento] || []).map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="form-label">Barrio</label>
                                    <input className="form-control" name="barrio" placeholder="Ej: Chapinero" value={formData.barrio} onChange={handleChange} />
                                </div>
                                <div>
                                    <label className="form-label">Tipo</label>
                                    <select className="form-control" name="tipo_inmueble" value={formData.tipo_inmueble} onChange={handleChange}>
                                        {['Apartamento','Casa','Local','Apartaestudio','Finca'].map(t => <option key={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="form-label">Área (m²)</label>
                                    <input className="form-control" type="number" name="area_m2" value={formData.area_m2} onChange={handleChange} />
                                </div>
                                <div>
                                    <label className="form-label">Estrato</label>
                                    <input className="form-control" type="number" name="estrato" min="1" max="6" value={formData.estrato} onChange={handleChange} />
                                </div>
                                <div>
                                    <label className="form-label">Habitaciones</label>
                                    <input className="form-control" type="number" name="habitaciones" min="0" value={formData.habitaciones} onChange={handleChange} />
                                </div>
                                <div>
                                    <label className="form-label">Baños</label>
                                    <input className="form-control" type="number" name="banos" min="0" value={formData.banos} onChange={handleChange} />
                                </div>
                                <div>
                                    <label className="form-label">Parqueaderos</label>
                                    <input className="form-control" type="number" name="parqueaderos" min="0" value={formData.parqueaderos} onChange={handleChange} />
                                </div>
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem', padding: '0.75rem' }}>
                                {editando ? 'Guardar Cambios' : 'Registrar Inmueble'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Inmuebles;
