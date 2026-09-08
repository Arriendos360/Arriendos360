import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Upload, Download, Trash2, AlertCircle, CheckCircle } from 'lucide-react';
import { TIPOS_ANEXO_CONOCIDOS, TAMANO_MAXIMO_ANEXO_MB } from 'arriendos360-contracts';

import { useSesion } from '../auth/sesion';
import api from '../services/api';
import { descargarPdf } from '../services/descargas';

/**
 * Detalle de un contrato, con sus anexos.
 *
 * ES UNA VISTA NUEVA, y existe por un cambio de experiencia de usuario que viene
 * del Capítulo 2: el anexo ya no nace con el contrato. Antes el PDF viajaba en
 * el mismo formulario que lo creaba, lo que obligaba a tener el archivo escaneado
 * en el momento de firmar y dejaba un solo archivo, sin tipo y sin forma de
 * añadir un otrosí después.
 *
 * Ahora son dos pasos: el propietario crea el contrato y luego entra aquí a
 * adjuntar. Es un clic más y un modelo mental más honesto — un contrato existe
 * antes de estar escaneado.
 *
 * La ruta es accesible a los dos roles. El inquilino ve su contrato y se puede
 * descargar lo que hay firmado; lo que no ve es el formulario de carga. El
 * backend lo vuelve a comprobar de todas formas (regla dura 8): esto es
 * presentación, no seguridad.
 */

const ETIQUETA_ESTADO = {
    activo: 'Activo',
    finalizado: 'Finalizado',
    cancelado: 'Cancelado'
};

const ETIQUETA_TIPO = {
    CONTRATO_FIRMADO: 'Contrato firmado',
    OTROSI: 'Otrosí'
};

const formatearFecha = (valor) =>
    valor ? new Date(valor).toLocaleDateString('es-CO', { timeZone: 'UTC' }) : 'N/A';

const ContratoDetalle = () => {
    const { id } = useParams();
    const { esPropietario } = useSesion();

    const [contrato, setContrato] = useState(null);
    const [anexos, setAnexos] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [aviso, setAviso] = useState(null);

    const [archivo, setArchivo] = useState(null);
    const [tipo, setTipo] = useState(TIPOS_ANEXO_CONOCIDOS[0]);
    const [subiendo, setSubiendo] = useState(false);

    const notificar = (mensaje, tono = 'error') => {
        setAviso({ mensaje, tono });
        setTimeout(() => setAviso(null), 4000);
    };

    const cargar = useCallback(async () => {
        try {
            const [detalle, listado] = await Promise.all([
                api.get(`/contratos/${id}`),
                api.get(`/contratos/${id}/anexos`)
            ]);
            setContrato(detalle.data);
            setAnexos(listado.data);
        } catch (err) {
            setError(err.response?.data?.mensaje || 'No se pudo cargar el contrato');
        } finally {
            setCargando(false);
        }
    }, [id]);

    useEffect(() => {
        cargar();
    }, [cargar]);

    const subir = async (evento) => {
        evento.preventDefault();

        if (!archivo) {
            notificar('Elige un archivo PDF');
            return;
        }

        // Se comprueba aquí ADEMÁS de en el servidor. No sustituye al 413 —el
        // cliente no es de fiar y el backend lo rechaza igual— pero evita subir
        // diez megas por una red móvil para que te los rechacen al final.
        if (archivo.size > TAMANO_MAXIMO_ANEXO_MB * 1024 * 1024) {
            notificar(`El archivo supera el máximo de ${TAMANO_MAXIMO_ANEXO_MB} MB`);
            return;
        }

        const cuerpo = new FormData();
        cuerpo.append('file', archivo);
        cuerpo.append('tipo', tipo);

        setSubiendo(true);
        try {
            await api.post(`/contratos/${id}/anexos`, cuerpo, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setArchivo(null);
            evento.target.reset();
            await cargar();
            notificar('Anexo cargado', 'exito');
        } catch (err) {
            notificar(err.response?.data?.mensaje || 'No se pudo cargar el anexo');
        } finally {
            setSubiendo(false);
        }
    };

    const descargar = async (anexo) => {
        try {
            // Por `fetch` y blob, con el interceptor que pone el token. Es el
            // mismo camino que los recibos: el archivo NO tiene URL pública.
            await descargarPdf(
                `/contratos/${id}/anexos/${anexo.id_anexo}`,
                `${(ETIQUETA_TIPO[anexo.tipo] || anexo.tipo).replace(/\s+/g, '-')}.pdf`
            );
        } catch (err) {
            notificar('No se pudo descargar el anexo');
        }
    };

    const eliminar = async (anexo) => {
        try {
            await api.delete(`/contratos/${id}/anexos/${anexo.id_anexo}`);
            await cargar();
            notificar('Anexo eliminado', 'exito');
        } catch (err) {
            notificar(err.response?.data?.mensaje || 'No se pudo eliminar el anexo');
        }
    };

    if (cargando) {
        return <div className="card">Cargando…</div>;
    }

    if (error) {
        return (
            <div className="card">
                <p style={{ color: '#b91c1c' }}>{error}</p>
                <Link to="/contratos" className="btn">Volver a contratos</Link>
            </div>
        );
    }

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <Link to="/contratos" className="btn" style={{ padding: '0.4rem' }} aria-label="Volver">
                    <ArrowLeft size={18} />
                </Link>
                <h3 style={{ margin: 0 }}>Contrato</h3>
                <span className={`badge ${contrato.estado === 'activo' ? 'badge-success' : 'badge-pending'}`}>
                    {ETIQUETA_ESTADO[contrato.estado] || contrato.estado}
                </span>
            </div>

            {aviso && (
                <div
                    className="card"
                    style={{
                        marginBottom: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: aviso.tono === 'exito' ? '#166534' : '#b91c1c'
                    }}
                >
                    {aviso.tono === 'exito' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {aviso.mensaje}
                </div>
            )}

            <div className="card" style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginTop: 0 }}>Condiciones</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    {[
                        ['Inmueble', contrato.Inmueble ? contrato.Inmueble.direccion : contrato.id_inmueble],
                        ['Inquilino', contrato.Inquilino ? `${contrato.Inquilino.nombres} ${contrato.Inquilino.apellidos}` : contrato.id_inquilino],
                        ['Inicio', formatearFecha(contrato.inicio)],
                        ['Fin', formatearFecha(contrato.fin)],
                        ['Canon', `$${parseFloat(contrato.canon).toLocaleString()}`],
                        ['Inicio de corte', formatearFecha(contrato.fecha_inicio_corte)],
                        ['Día límite de pago', contrato.fecha_limite_pago],
                        ['Deudor solidario', contrato.nombre_deudor_solidario || '—']
                    ].map(([etiqueta, valor]) => (
                        <div key={etiqueta}>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>{etiqueta}</div>
                            <div style={{ fontWeight: '600' }}>{valor}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="card">
                <h4 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <FileText size={18} /> Anexos
                </h4>

                {esPropietario && (
                    <form
                        onSubmit={subir}
                        style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.5rem' }}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: '500' }}>Tipo</label>
                            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                                {TIPOS_ANEXO_CONOCIDOS.map((valor) => (
                                    <option key={valor} value={valor}>{ETIQUETA_TIPO[valor] || valor}</option>
                                ))}
                            </select>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: '500' }}>
                                Archivo PDF (máx. {TAMANO_MAXIMO_ANEXO_MB} MB)
                            </label>
                            <input
                                type="file"
                                accept="application/pdf"
                                onChange={(e) => setArchivo(e.target.files[0])}
                            />
                        </div>

                        <button type="submit" className="btn btn-primary" disabled={subiendo}>
                            <Upload size={15} /> {subiendo ? 'Subiendo…' : 'Adjuntar'}
                        </button>
                    </form>
                )}

                {anexos.length === 0 ? (
                    <p style={{ color: '#64748b' }}>
                        {esPropietario
                            ? 'Todavía no hay anexos. Adjunta el contrato firmado.'
                            : 'Tu arrendador todavía no ha adjuntado el contrato firmado.'}
                    </p>
                ) : (
                    <table style={{ width: '100%' }}>
                        <tbody>
                            {anexos.map((anexo) => (
                                <tr key={anexo.id_anexo}>
                                    <td style={{ fontWeight: '600' }}>{ETIQUETA_TIPO[anexo.tipo] || anexo.tipo}</td>
                                    <td style={{ color: '#64748b' }}>{formatearFecha(anexo.fecha_creacion)}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <button className="btn" onClick={() => descargar(anexo)} title="Descargar">
                                            <Download size={15} />
                                        </button>
                                        {esPropietario && (
                                            <button
                                                className="btn"
                                                style={{ color: '#b91c1c' }}
                                                onClick={() => eliminar(anexo)}
                                                title="Eliminar"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default ContratoDetalle;
