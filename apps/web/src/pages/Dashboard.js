import React, { useState, useEffect } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { useNavigate } from 'react-router-dom';
import {
    Chart as ChartJS, CategoryScale, LinearScale, BarElement,
    Title, Tooltip, Legend, ArcElement
} from 'chart.js';
import api from '../services/api';
import {
    TrendingUp, Home, AlertCircle, FileText,
    MapPin, ArrowRight, Zap, Calendar,
    CheckCircle, Clock
} from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

const Dashboard = () => {
    const navigate = useNavigate();
    const [resumen, setResumen]       = useState(null);
    const [pagos, setPagos]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [ejecutando, setEjecutando] = useState(false);
    const [motorMsg, setMotorMsg]     = useState('');

    const fetchData = async () => {
        try {
            const [resRes, pagosRes] = await Promise.all([
                api.get('/dashboard/resumen'),
                api.get('/pagos'),
            ]);
            setResumen(resRes.data);
            setPagos(pagosRes.data);
        } catch (error) {
            console.error('Error al cargar dashboard:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const ejecutarMotor = async () => {
        setEjecutando(true);
        setMotorMsg('');
        try {
            const res = await api.post('/admin/ejecutar-motor');
            setMotorMsg('✅ ' + res.data.mensaje);
            await fetchData();
        } catch {
            setMotorMsg('❌ Error al ejecutar motor');
        } finally {
            setEjecutando(false);
        }
    };

    const formatDate = (dateString, options = { month: 'long', year: 'numeric' }) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('es-CO', { ...options, timeZone: 'UTC' });
    };

    if (loading) return <div className="loading">Cargando dashboard...</div>;

    // ── Gráfico barras ──
    const pagosPorMes = {};
    pagos.forEach(p => {
        if (p.estado === 2) {
            const mes = formatDate(p.mes_correspondiente, { month: 'short', year: '2-digit' });
            pagosPorMes[mes] = (pagosPorMes[mes] || 0) + parseFloat(p.monto_total || 0);
        }
    });
    const meses = Object.keys(pagosPorMes).slice(-6);
    const barData = {
        labels: meses.length > 0 ? meses : ['Sin datos'],
        datasets: [{ label: 'Ingresos ($)', data: meses.map(m => pagosPorMes[m]), backgroundColor: 'rgba(37,99,235,0.75)', borderColor: '#2563eb', borderWidth: 2, borderRadius: 6 }]
    };
    const barOptions = {
        responsive: true, plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } }
    };

    // ── Dona ──
    const pagados    = pagos.filter(p => p.estado === 2).length;
    const pendientes = pagos.filter(p => p.estado === 1 || p.estado === 4).length;
    const mora       = pagos.filter(p => p.estado === 3).length;
    const donutData  = {
        labels: ['Pagados', 'Pendientes', 'En Mora'],
        datasets: [{ data: [pagados, pendientes, mora], backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'], borderWidth: 2 }]
    };

    // ── Requieren atención ──
    const requierenAtencion = pagos
        .filter(p => p.estado === 1 || p.estado === 3 || p.estado === 4)
        .sort((a, b) => { const o = { 3: 0, 4: 1, 1: 2 }; return (o[a.estado] ?? 3) - (o[b.estado] ?? 3); })
        .slice(0, 5);

    const kpis = [
        { label: 'Ingresos Totales',     value: '$' + parseFloat(resumen?.ingresos_totales || 0).toLocaleString(), icon: <TrendingUp size={20} color="#22c55e" />, bg: '#dcfce7' },
        { label: 'Contratos Activos',    value: resumen?.contratos?.activos ?? 0,                                  icon: <FileText size={20} color="#2563eb" />,    bg: '#dbeafe' },
        { label: 'Inmuebles Arrendados', value: resumen?.inmuebles?.arrendados ?? 0,                               icon: <Home size={20} color="#7c3aed" />,        bg: '#ede9fe' },
        { label: 'Pagos Pendientes',     value: resumen?.pagos_pendientes ?? 0,                                    icon: <AlertCircle size={20} color="#ef4444" />, bg: '#fee2e2', alert: (resumen?.pagos_pendientes ?? 0) > 0 },
    ];

    const getEstadoConfig = (estado) => ({
        3: { label: 'En Mora',      bg: '#fef2f2', border: '#fca5a5', badge: '#fee2e2', badgeText: '#b91c1c', dot: '#ef4444' },
        4: { label: 'Pago Parcial', bg: '#fffbeb', border: '#fcd34d', badge: '#fef9c3', badgeText: '#a16207', dot: '#f59e0b' },
        2: { label: 'Pagado',       bg: '#f0fdf4', border: '#bbf7d0', badge: '#dcfce7', badgeText: '#15803d', dot: '#22c55e' },
        1: { label: 'Pendiente',    bg: '#f8fafc', border: '#e2e8f0', badge: '#f1f5f9', badgeText: '#475569', dot: '#94a3b8' },
    }[estado] || { label: '—', bg: '#f8fafc', border: '#e2e8f0', badge: '#f1f5f9', badgeText: '#475569', dot: '#cbd5e1' });


    return (
        <div className="fade-in">

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.875rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>Dashboard</h2>
                    <p style={{ color: '#64748b', marginTop: '0.25rem' }}>Resumen de tus arrendamientos en tiempo real.</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                    <button onClick={ejecutarMotor} disabled={ejecutando} className="btn btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Zap size={16} /> {ejecutando ? 'Ejecutando...' : 'Motor Financiero'}
                    </button>
                    {motorMsg && <span style={{ fontSize: '0.78rem', color: motorMsg.startsWith('✅') ? '#16a34a' : '#ef4444' }}>{motorMsg}</span>}
                </div>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem', marginBottom: '1.75rem' }}>
                {kpis.map((k, i) => (
                    <div key={i} className="card" style={{ margin: 0, position: 'relative', overflow: 'hidden', ...(k.alert ? { borderColor: '#fca5a5', boxShadow: '0 0 0 2px rgba(239,68,68,0.1)' } : {}) }}>
                        {k.alert && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg,#ef4444,#f97316)' }} />}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <span className="stat-label">{k.label}</span>
                            <div style={{ background: k.bg, padding: '0.45rem', borderRadius: '0.5rem' }}>{k.icon}</div>
                        </div>
                        <div className="stat-value" style={{ fontSize: '1.75rem' }}>{k.value}</div>
                    </div>
                ))}
            </div>

            {/* Gráficos */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', marginBottom: '1.75rem' }}>
                <div className="card" style={{ margin: 0 }}>
                    <h4 style={{ marginBottom: '1rem', color: '#0f172a', fontWeight: '700' }}>Ingresos por Mes</h4>
                    <Bar data={barData} options={barOptions} height={100} />
                </div>
                <div className="card" style={{ margin: 0 }}>
                    <h4 style={{ marginBottom: '1rem', color: '#0f172a', fontWeight: '700' }}>Estado de Pagos</h4>
                    {(pagados + pendientes + mora) > 0
                        ? <Doughnut data={donutData} options={{ plugins: { legend: { position: 'bottom' } } }} />
                        : <div style={{ textAlign: 'center', color: '#94a3b8', padding: '3rem 0', fontSize: '0.9rem' }}>Sin pagos registrados</div>
                    }
                </div>
            </div>

            {/* Requieren atención */}
            {requierenAtencion.length > 0 && (
                <div className="card" style={{ margin: '0 0 1.75rem 0', padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', background: '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: mora > 0 ? '#ef4444' : '#f59e0b', boxShadow: `0 0 0 3px ${mora > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}` }} />
                            <h4 style={{ fontWeight: '700', color: '#0f172a', fontSize: '0.95rem' }}>
                                Requieren atención
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: '600', background: mora > 0 ? '#fee2e2' : '#fef9c3', color: mora > 0 ? '#b91c1c' : '#a16207', padding: '0.1rem 0.5rem', borderRadius: '999px' }}>
                                    {requierenAtencion.length} cobro{requierenAtencion.length > 1 ? 's' : ''}
                                </span>
                            </h4>
                        </div>
                        <button onClick={() => navigate('/pagos')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: '1.5px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.4rem 0.875rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600', color: '#475569' }}>
                            Ver todos <ArrowRight size={14} />
                        </button>
                    </div>
                    {requierenAtencion.map((pago, idx) => {
                        const cfg = getEstadoConfig(pago.estado);
                        const esMora = pago.estado === 3;
                        return (
                            <div key={pago.id_pago} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1.5rem', background: cfg.bg, borderBottom: idx < requierenAtencion.length - 1 ? `1px solid ${cfg.border}` : 'none' }}>
                                <div style={{ width: '4px', height: '40px', borderRadius: '2px', background: cfg.dot, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                                        <MapPin size={13} color="#94a3b8" />
                                        <span style={{ fontWeight: '700', fontSize: '0.875rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {pago.Contrato?.Inmueble?.direccion || `Contrato #${pago.id_contrato}`}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                                        <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                            <Calendar size={11} /> {formatDate(pago.mes_correspondiente)}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Arrendatario: {pago.Contrato?.id_inquilino || '--'}</span>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <div style={{ fontWeight: '800', fontSize: '1rem', color: esMora ? '#b91c1c' : '#0f172a' }}>${parseFloat(pago.saldo_pendiente).toLocaleString()}</div>
                                    <span style={{ fontSize: '0.7rem', background: cfg.badge, color: cfg.badgeText, padding: '0.1rem 0.45rem', borderRadius: '999px', fontWeight: '700' }}>{cfg.label}</span>
                                </div>
                                <button onClick={() => navigate('/pagos')} className="btn btn-primary"
                                    style={{ flexShrink: 0, padding: '0.5rem 1rem', fontSize: '0.82rem', background: esMora ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : undefined }}>
                                    Registrar Pago →
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Todo al día */}
            {requierenAtencion.length === 0 && pagos.length > 0 && (
                <div style={{ textAlign: 'center', padding: '1.5rem', background: '#f0fdf4', borderRadius: '1rem', border: '1px solid #bbf7d0', marginTop: '1.75rem' }}>
                    <p style={{ fontWeight: '700', color: '#15803d' }}>🎉 ¡Todo al día! No hay cobros pendientes.</p>
                </div>
            )}
        </div>
    );
};

export default Dashboard;