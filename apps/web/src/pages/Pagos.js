import React, { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertTriangle, Ban, Download, History, X, Receipt, Search, Calendar, MapPin } from 'lucide-react';

import { ESTADOS_CUENTA_COBRO, MEDIOS_PAGO_CONOCIDOS } from 'arriendos360-contracts';

import { useSesion } from '../auth/sesion';
import api from '../services/api';
import { abrirPdf } from '../services/descargas';

/**
 * Los cuatro estados de una cuenta de cobro, del catalogo compartido.
 *
 * Hasta el paso 6c esta pantalla traducia los enteros 1, 2, 3 y 4 con un
 * `switch` propio, que era una de las cuatro copias del mapa repartidas por el
 * proyecto. Ahora la lista viene de `packages/contracts`, que es la misma que
 * valida el modelo y la que declara el `CHECK` de la migracion.
 */
const [PENDIENTE, PAGADA, PARCIAL, EN_MORA] = ESTADOS_CUENTA_COBRO;

const Pagos = () => {
    const { esPropietario } = useSesion();

    const [tab, setTab] = useState('cobros');
    const [pagos, setPagos] = useState([]);
    const [transacciones, setTransacciones] = useState([]);
    const [historial, setHistorial] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filtro, setFiltro] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('todos');
    const [filtroHistorial, setFiltroHistorial] = useState('');
    const [selectedPago, setSelectedPago] = useState(null);
    const [showAbonosModal, setShowAbonosModal] = useState(false);
    const [showPayModal, setShowPayModal] = useState(false);
    // Los nombres son los del cuerpo que fija el Capitulo 2 para
    // `POST /api/pagos`: `monto` y `medio_pago`, no `monto_pagado` ni
    // `tipo_transaccion`. `tipo` lo pone el envio, que hoy solo tiene un valor.
    const [payFormData, setPayFormData] = useState({
        monto: '', medio_pago: MEDIOS_PAGO_CONOCIDOS[0], observaciones: ''
    });

    useEffect(() => {
        const fetchAll = async () => {
            try {
                const [pagosRes, historialRes] = await Promise.all([
                    api.get('/pagos'),
                    api.get('/pagos/historial-transacciones').catch(() => ({ data: [] }))
                ]);
                setPagos(pagosRes.data);
                setHistorial(historialRes.data);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, []);

    const formatDate = (dateString, options = { month: 'long', year: 'numeric' }) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('es-CO', { ...options, timeZone: 'UTC' });
    };

    const recargar = async () => {
        const [pagosRes, histRes] = await Promise.all([
            api.get('/pagos'),
            api.get('/pagos/historial-transacciones').catch(() => ({ data: [] }))
        ]);
        setPagos(pagosRes.data);
        setHistorial(histRes.data);
    };

    const fetchTransacciones = async (id_cuenta_cobro) => {
        try {
            const res = await api.get(`/pagos/${id_cuenta_cobro}/transacciones`);
            setTransacciones(res.data);
            setShowAbonosModal(true);
        } catch { alert('Error al cargar transacciones'); }
    };

    const handleRegistrarPago = async (e) => {
        e.preventDefault();
        try {
            await api.post('/pagos', {
                id_cuenta_cobro: selectedPago.id_cuenta_cobro,
                tipo: 'INGRESO',
                ...payFormData
            });
            setShowPayModal(false);
            setPayFormData({ monto: '', medio_pago: MEDIOS_PAGO_CONOCIDOS[0], observaciones: '' });
            await recargar();
        } catch (err) {
            alert('Error: ' + (err.response?.data?.mensaje || err.message));
        }
    };

    /**
     * Anula una transaccion registrada por error.
     *
     * No la borra: el servidor le cambia el estado y el saldo de la cuenta se
     * corrige solo, porque la suma que lo deriva deja de contarla. Por eso hay
     * que recargar las listas y el detalle en vez de tocarlos en memoria.
     */
    const handleAnular = async (id_transaccion) => {
        if (!window.confirm('Anular esta transaccion? El saldo de la cuenta de cobro se recalculara.')) return;
        try {
            await api.post(`/pagos/transacciones/${id_transaccion}/anular`);
            await recargar();
            await fetchTransacciones(selectedPago.id_cuenta_cobro);
        } catch (err) {
            alert('Error: ' + (err.response?.data?.mensaje || err.message));
        }
    };

    const getStatusInfo = (estado) => ({
        [PENDIENTE]: { label: 'Pendiente',    class: 'badge-pending', icon: <Clock size={13} /> },
        [PAGADA]:    { label: 'Pagado',       class: 'badge-success', icon: <CheckCircle size={13} /> },
        [EN_MORA]:   { label: 'En Mora',      class: 'badge-error',   icon: <AlertTriangle size={13} /> },
        [PARCIAL]:   { label: 'Pago Parcial', class: 'badge-warning', icon: <Clock size={13} /> },
    }[estado] || { label: '—', class: '', icon: null });

    const pagosFiltrados = pagos.filter(p => {
        const q = filtro.toLowerCase();
        const matchTexto = !filtro
            || p.Contrato?.Inmueble?.direccion?.toLowerCase().includes(q)
            || (p.Contrato?.id_inquilino || '').toLowerCase().includes(q)
            || String(p.id_contrato).includes(q);
        const matchEstado = filtroEstado === 'todos'
            || (filtroEstado === 'pendiente' && (p.estado === PENDIENTE || p.estado === PARCIAL))
            || (filtroEstado === 'pagado'    && p.estado === PAGADA)
            || (filtroEstado === 'mora'      && p.estado === EN_MORA);
        return matchTexto && matchEstado;
    });

    const historialFiltrado = historial.filter(a =>
        !filtroHistorial
        || a.CuentaCobro?.Contrato?.Inmueble?.direccion?.toLowerCase().includes(filtroHistorial.toLowerCase())
        || a.medio_pago?.toLowerCase().includes(filtroHistorial.toLowerCase())
    );

    const totalHistorial = historialFiltrado.reduce((s, a) => s + parseFloat(a.monto || 0), 0);

    if (loading) return <div className="loading">Cargando gestión financiera...</div>;

    const TABS = [
        { key: 'cobros',    label: 'Cobros',               count: pagos.length },
        { key: 'historial', label: 'Historial de Pagos',   count: historial.length },
    ];

    return (
        <div className="fade-in">
            {/* Header */}
            <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.875rem', fontWeight: '800', color: '#0f172a' }}>Gestión Financiera</h2>
                <p style={{ color: '#64748b' }}>Control de cobros, pagos y comprobantes de transacciones.</p>
            </div>

            {/* Tab switcher */}
            <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', gap: '0.25rem' }}>
                {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)} style={{
                        padding: '0.65rem 1.25rem', border: 'none', background: 'transparent',
                        cursor: 'pointer', fontSize: '0.9rem', fontWeight: tab === t.key ? '700' : '500',
                        color: tab === t.key ? '#2563eb' : '#64748b',
                        borderBottom: tab === t.key ? '2px solid #2563eb' : '2px solid transparent',
                        marginBottom: '-2px', transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', gap: '0.5rem'
                    }}>
                        {t.label}
                        <span style={{
                            fontSize: '0.72rem', fontWeight: '700', padding: '0.1rem 0.4rem',
                            borderRadius: '999px', background: tab === t.key ? '#eff6ff' : '#f1f5f9',
                            color: tab === t.key ? '#2563eb' : '#94a3b8'
                        }}>{t.count}</span>
                    </button>
                ))}
            </div>

            {/* ── TAB COBROS ── */}
            {tab === 'cobros' && (
                <>
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div className="card" style={{ flex: 1, minWidth: '220px', padding: '0.65rem 1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Search size={16} color="#94a3b8" />
                            <input type="text" placeholder="Buscar por dirección, cédula o # contrato..."
                                value={filtro} onChange={e => setFiltro(e.target.value)}
                                style={{ border: 'none', outline: 'none', flex: 1, fontSize: '0.875rem', background: 'transparent' }} />
                            {filtro && <button onClick={() => setFiltro('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>✕</button>}
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {[
                                { key: 'todos',     label: 'Todos',      color: '#475569', bg: '#f1f5f9', count: pagos.length },
                                { key: 'pendiente', label: 'Pendientes', color: '#854d0e', bg: '#fef9c3', count: pagos.filter(p => p.estado === PENDIENTE || p.estado === PARCIAL).length },
                                { key: 'pagado',    label: 'Pagados',    color: '#166534', bg: '#dcfce7', count: pagos.filter(p => p.estado === PAGADA).length },
                                { key: 'mora',      label: 'En Mora',    color: '#991b1b', bg: '#fee2e2', count: pagos.filter(p => p.estado === EN_MORA).length },
                            ].map(t => (
                                <button key={t.key} onClick={() => setFiltroEstado(t.key)} style={{
                                    padding: '0.4rem 0.8rem', borderRadius: '999px', cursor: 'pointer', fontSize: '0.82rem',
                                    border: filtroEstado === t.key ? `2px solid ${t.color}` : '2px solid transparent',
                                    background: filtroEstado === t.key ? t.bg : '#f8fafc',
                                    color: filtroEstado === t.key ? t.color : '#64748b',
                                    fontWeight: filtroEstado === t.key ? '700' : '400', transition: 'all 0.15s'
                                }}>
                                    {t.label} <span style={{ fontSize: '0.72rem' }}>({t.count})</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>Mes de Cobro</th>
                                    <th>Inmueble</th>
                                    {esPropietario && <th>Arrendatario</th>}
                                    <th>Monto</th>
                                    <th>Saldo</th>
                                    <th>Estado</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pagosFiltrados.length === 0 && (
                                    <tr><td colSpan="7" style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>Sin resultados.</td></tr>
                                )}
                                {pagosFiltrados.map(pago => {
                                    const st = getStatusInfo(pago.estado);
                                    return (
                                        <tr key={pago.id_cuenta_cobro}>
                                            <td style={{ fontWeight: '600' }}>
                                                {formatDate(pago.inicio)}
                                            </td>
                                            <td>
                                                <div style={{ fontWeight: '500', fontSize: '0.875rem' }}>{pago.Contrato?.Inmueble?.direccion || `#${pago.id_contrato}`}</div>
                                                <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{pago.Contrato?.Inmueble?.municipio}</div>
                                            </td>
                                            {esPropietario && <td style={{ color: '#64748b', fontSize: '0.875rem' }}>{pago.Contrato?.id_inquilino || '--'}</td>}
                                            <td style={{ fontWeight: '600' }}>${parseFloat(pago.valor).toLocaleString()}</td>
                                            <td style={{ color: parseFloat(pago.saldo_pendiente) > 0 ? '#ef4444' : '#10b981', fontWeight: '700' }}>
                                                ${parseFloat(pago.saldo_pendiente).toLocaleString()}
                                            </td>
                                            <td>
                                                <span className={`badge ${st.class}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    {st.icon} {st.label}
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    {esPropietario && pago.estado !== PAGADA && (
                                                        <button className="btn btn-primary"
                                                            onClick={() => { setSelectedPago(pago); setShowPayModal(true); }}
                                                            style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}>
                                                            Registrar Pago
                                                        </button>
                                                    )}
                                                    {!esPropietario && pago.estado !== PAGADA && (
                                                        <span style={{ fontSize: '0.78rem', color: '#f59e0b', fontWeight: '600', background: '#fef9c3', padding: '0.3rem 0.6rem', borderRadius: '0.375rem', whiteSpace: 'nowrap' }}>
                                                            ⏳ Pendiente
                                                        </span>
                                                    )}
                                                    {parseFloat(pago.saldo_pendiente) < parseFloat(pago.valor) && (
                                                        <>
                                                            <button className="btn-icon-subtle" title="Ver transacciones" onClick={() => { setSelectedPago(pago); fetchTransacciones(pago.id_cuenta_cobro); }}>
                                                                <History size={16} />
                                                            </button>
                                                            <button className="btn-icon-subtle" title="Recibo" onClick={() => abrirPdf(`/pagos/${pago.id_cuenta_cobro}/recibo`, `Recibo_${pago.id_cuenta_cobro}.pdf`)}>
                                                                <Download size={16} />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* ── TAB HISTORIAL ── */}
            {tab === 'historial' && (
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
                        <div className="card" style={{ flex: 1, minWidth: '220px', padding: '0.65rem 1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Search size={16} color="#94a3b8" />
                            <input type="text" placeholder="Buscar por dirección o método de pago..."
                                value={filtroHistorial} onChange={e => setFiltroHistorial(e.target.value)}
                                style={{ border: 'none', outline: 'none', flex: 1, fontSize: '0.875rem', background: 'transparent' }} />
                            {filtroHistorial && <button onClick={() => setFiltroHistorial('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>✕</button>}
                        </div>
                        {historial.length > 0 && (
                            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.75rem', padding: '0.6rem 1.1rem', textAlign: 'right' }}>
                                <p style={{ fontSize: '0.7rem', color: '#166534', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total pagado</p>
                                <p style={{ fontSize: '1.25rem', fontWeight: '800', color: '#15803d' }}>${totalHistorial.toLocaleString()}</p>
                            </div>
                        )}
                    </div>

                    {historialFiltrado.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '4rem', background: '#fff', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
                            <Receipt size={40} color="#cbd5e1" style={{ margin: '0 auto 1rem' }} />
                            <p style={{ color: '#94a3b8' }}>No hay transacciones registradas.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            {historialFiltrado.map((abono, idx) => {
                                const saldado = parseFloat(abono.saldo_restante_momento) === 0;
                                // Una transaccion anulada sigue en la lista a
                                // proposito: esconderla seria esconder que el
                                // movimiento se registro y se corrigio.
                                const anulada = abono.estado === 'ANULADA';
                                return (
                                    <div key={abono.id_transaccion} style={{ background: '#fff', borderRadius: '0.875rem', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', alignItems: 'stretch', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', transition: 'box-shadow 0.15s' }}
                                        onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'}
                                        onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'}>
                                        <div style={{ width: '4px', background: anulada ? '#94a3b8' : (saldado ? '#22c55e' : '#f59e0b'), flexShrink: 0 }} />
                                        <div style={{ padding: '0.875rem 1rem', borderRight: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minWidth: '52px', background: '#fafafa' }}>
                                            <span style={{ fontSize: '0.6rem', color: '#94a3b8', textTransform: 'uppercase' }}>#</span>
                                            <span style={{ fontWeight: '700', color: '#475569' }}>{String(idx + 1).padStart(2, '0')}</span>
                                        </div>
                                        <div style={{ flex: 1, padding: '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                                    <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#0f172a' }}>Abono a Canon</span>
                                                    <span style={{ fontSize: '0.68rem', fontWeight: '700', padding: '0.1rem 0.45rem', borderRadius: '999px', background: anulada ? '#f1f5f9' : (saldado ? '#dcfce7' : '#fef9c3'), color: anulada ? '#64748b' : (saldado ? '#15803d' : '#a16207') }}>
                                                        {anulada ? 'Anulada' : (saldado ? '✓ Saldado' : 'Parcial')}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><MapPin size={11} />{abono.CuentaCobro?.Contrato?.Inmueble?.direccion}</span>
                                                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Calendar size={11} />{formatDate(abono.fecha_pago, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{abono.medio_pago}</span>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: anulada ? '#94a3b8' : '#15803d', letterSpacing: '-0.02em', textDecoration: anulada ? 'line-through' : 'none' }}>${parseFloat(abono.monto).toLocaleString()}</div>
                                                {!saldado && <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: '600' }}>Saldo: ${parseFloat(abono.saldo_restante_momento).toLocaleString()}</div>}
                                            </div>
                                        </div>
                                        <div style={{ padding: '0.875rem', display: 'flex', alignItems: 'center', borderLeft: '1px solid #f1f5f9' }}>
                                            <button onClick={() => abrirPdf(`/pagos/transacciones/${abono.id_transaccion}/comprobante`, `Comprobante_${abono.id_transaccion}.pdf`)}
                                                style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.5rem 0.875rem', cursor: 'pointer', fontWeight: '600', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem', boxShadow: '0 2px 6px rgba(37,99,235,0.25)' }}>
                                                <Download size={13} /> Descargar
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {/* Modal registrar pago */}
            {showPayModal && (
                <div className="modal-overlay">
                    <div className="card modal-content" style={{ maxWidth: '400px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                            <div>
                                <h4 style={{ fontWeight: '700' }}>Registrar Abono</h4>
                                <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>Saldo pendiente: <strong style={{ color: '#ef4444' }}>${parseFloat(selectedPago?.saldo_pendiente).toLocaleString()}</strong></p>
                            </div>
                            <button className="btn-icon" onClick={() => setShowPayModal(false)}><X size={20} /></button>
                        </div>
                        <form onSubmit={handleRegistrarPago}>
                            <label className="form-label">Monto a pagar</label>
                            <input type="number" className="form-control" value={payFormData.monto}
                                onChange={e => setPayFormData({...payFormData, monto: e.target.value})}
                                max={selectedPago?.saldo_pendiente} required />
                            <label className="form-label" style={{ marginTop: '1rem' }}>Método de pago</label>
                            {/* Catálogo ABIERTO: la lista es una sugerencia del
                                desplegable, no un valor que la API valide. */}
                            <select className="form-control" value={payFormData.medio_pago}
                                onChange={e => setPayFormData({...payFormData, medio_pago: e.target.value})}>
                                {MEDIOS_PAGO_CONOCIDOS.map(m => <option key={m}>{m}</option>)}
                            </select>
                            <label className="form-label" style={{ marginTop: '1rem' }}>Observaciones</label>
                            <textarea className="form-control" value={payFormData.observaciones}
                                onChange={e => setPayFormData({...payFormData, observaciones: e.target.value})} rows={3} />
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem', padding: '0.75rem' }}>
                                Confirmar Transacción
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal historial abonos */}
            {showAbonosModal && (
                <div className="modal-overlay">
                    <div className="card modal-content" style={{ maxWidth: '520px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                            <h4>Transacciones — Cobro #{selectedPago?.id_cuenta_cobro}</h4>
                            <button className="btn-icon" onClick={() => setShowAbonosModal(false)}><X size={20} /></button>
                        </div>
                        <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                            {transacciones.length === 0
                                ? <p style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Sin transacciones registradas.</p>
                                : transacciones.map(a => {
                                    const anulada = a.estado === 'ANULADA';
                                    return (
                                    <div key={a.id_transaccion} style={{ padding: '0.875rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <p style={{ fontWeight: '700', color: anulada ? '#94a3b8' : '#15803d', textDecoration: anulada ? 'line-through' : 'none' }}>${parseFloat(a.monto).toLocaleString()}</p>
                                            <p style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{new Date(a.fecha_pago).toLocaleString('es-CO')}</p>
                                            <p style={{ fontSize: '0.8rem', color: '#64748b' }}>{a.medio_pago}{anulada && ' · Anulada'}</p>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button className="btn-icon-subtle" title="Comprobante"
                                                onClick={() => abrirPdf(`/pagos/transacciones/${a.id_transaccion}/comprobante`, `Comprobante_${a.id_transaccion}.pdf`)}>
                                                <Receipt size={16} />
                                            </button>
                                            {esPropietario && !anulada && (
                                                <button className="btn-icon-subtle" title="Anular transacción"
                                                    onClick={() => handleAnular(a.id_transaccion)}>
                                                    <Ban size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    );
                                })
                            }
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Pagos;