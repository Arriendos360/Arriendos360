import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Receipt, Download, Calendar, MapPin, Search, CheckCircle, Clock } from 'lucide-react';

const Comprobantes = () => {
    const [abonos, setAbonos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filtro, setFiltro] = useState('');

    useEffect(() => {
        const fetchHistorial = async () => {
            try {
                const response = await api.get('/pagos/historial-abonos');
                setAbonos(response.data);
            } catch (error) {
                console.error('Error al cargar historial:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchHistorial();
    }, []);

    const abonosFiltrados = abonos.filter(abono =>
        abono.Pago?.Contrato?.Inmueble?.direccion?.toLowerCase().includes(filtro.toLowerCase()) ||
        abono.tipo_transaccion?.toLowerCase().includes(filtro.toLowerCase())
    );

    const totalPagado = abonosFiltrados.reduce((sum, a) => sum + parseFloat(a.monto || 0), 0);

    const formatDate = (dateString, options = { day: 'numeric', month: 'short', year: 'numeric' }) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('es-CO', { ...options, timeZone: 'UTC' });
    };

    if (loading) return <div className="loading">Cargando comprobantes...</div>;

    return (
        <div className="fade-in">
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.875rem', fontWeight: '800', color: '#0f172a' }}>Mis Comprobantes</h2>
                    <p style={{ color: '#64748b', marginTop: '0.25rem' }}>Historial de todos tus pagos y abonos realizados.</p>
                </div>
                {abonos.length > 0 && (
                    <div style={{ textAlign: 'right', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.75rem', padding: '0.75rem 1.25rem' }}>
                        <p style={{ fontSize: '0.75rem', color: '#166534', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total pagado</p>
                        <p style={{ fontSize: '1.5rem', fontWeight: '800', color: '#15803d' }}>${totalPagado.toLocaleString()}</p>
                    </div>
                )}
            </div>

            {/* Buscador */}
            <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <Search size={18} color="#94a3b8" />
                <input
                    type="text"
                    placeholder="Buscar por dirección o método de pago..."
                    value={filtro}
                    onChange={e => setFiltro(e.target.value)}
                    style={{ border: 'none', outline: 'none', flex: 1, fontSize: '0.9rem', background: 'transparent', color: '#0f172a' }}
                />
                {filtro && <button onClick={() => setFiltro('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1rem' }}>✕</button>}
            </div>

            {/* Sin resultados */}
            {abonosFiltrados.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '5rem 2rem', background: '#fff', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
                    <div style={{ width: '64px', height: '64px', background: '#f1f5f9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                        <Receipt size={28} color="#94a3b8" />
                    </div>
                    <p style={{ color: '#64748b', fontSize: '0.95rem' }}>No se encontraron transacciones en tu historial.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {abonosFiltrados.map((abono, idx) => {
                        const esPagado = parseFloat(abono.saldo_restante_momento) === 0;
                        return (
                            <div key={abono.id_abono} style={{
                                background: '#fff',
                                borderRadius: '1rem',
                                border: '1px solid #e2e8f0',
                                overflow: 'hidden',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                                transition: 'box-shadow 0.2s, transform 0.15s',
                                display: 'flex',
                                alignItems: 'stretch',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                            >
                                {/* Acento izquierdo de color */}
                                <div style={{ width: '4px', background: esPagado ? '#22c55e' : '#f59e0b', flexShrink: 0 }} />

                                {/* Número de transacción */}
                                <div style={{ padding: '1rem 1.25rem', borderRight: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minWidth: '60px', background: '#fafafa' }}>
                                    <span style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</span>
                                    <span style={{ fontWeight: '700', color: '#475569', fontSize: '1rem' }}>{String(idx + 1).padStart(2, '0')}</span>
                                </div>

                                {/* Contenido principal */}
                                <div style={{ flex: 1, padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ fontWeight: '700', fontSize: '0.95rem', color: '#0f172a' }}>Abono a Canon</span>
                                            <span style={{
                                                fontSize: '0.68rem', fontWeight: '700', padding: '0.15rem 0.5rem',
                                                borderRadius: '999px',
                                                background: esPagado ? '#dcfce7' : '#fef9c3',
                                                color: esPagado ? '#15803d' : '#a16207'
                                            }}>
                                                {esPagado ? '✓ Saldado' : 'Parcial'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                <MapPin size={12} /> {abono.Pago?.Contrato?.Inmueble?.direccion}
                                            </span>
                                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                <Calendar size={12} />
                                                {formatDate(abono.fecha_abono)}
                                            </span>
                                            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{abono.tipo_transaccion}</span>
                                        </div>
                                    </div>

                                    {/* Monto */}
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: '1.375rem', fontWeight: '800', color: '#15803d', letterSpacing: '-0.02em' }}>
                                            ${parseFloat(abono.monto).toLocaleString()}
                                        </div>
                                        {!esPagado && (
                                            <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: '600' }}>
                                                Saldo: ${parseFloat(abono.saldo_restante_momento).toLocaleString()}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Botón descarga */}
                                <div style={{ padding: '1rem', display: 'flex', alignItems: 'center', borderLeft: '1px solid #f1f5f9' }}>
                                    <button
                                        onClick={() => window.open(`http://localhost:3001/api/pagos/abono/${abono.id_abono}?token=${localStorage.getItem('token')}`)}
                                        style={{
                                            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                                            color: '#fff', border: 'none', borderRadius: '0.6rem',
                                            padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: '600',
                                            fontSize: '0.8rem', display: 'flex', alignItems: 'center',
                                            gap: '0.4rem', boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        <Download size={14} /> Descargar
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Comprobantes;
