import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, KeyRound, Pencil, Trash2, Upload } from 'lucide-react';
import { TAMANO_MAXIMO_ANEXO_MB, TIPOS_ANEXO_CONOCIDOS } from 'arriendos360-contracts';

import { useSesion } from '../auth/sesion';
import {
    actualizarContrato, descargarAnexo, eliminarAnexo, fechaDeContrato, finalizarContrato, listarAnexos,
    obtenerContrato, reemitirContrasenaInquilino, subirAnexo
} from '../features/contratos/api';
import {
    AreaTexto, ContrasenaTemporal, actuaComoPropietario, nombreDe, ubicacionDe, vigencia
} from '../features/contratos/piezas';
import {
    Badge, Button, Card, DateField, EmptyState, FormError, Input, Modal, MoneyField, formatearDinero, formatearFecha,
    formatearFechaHora
} from '../ui';

/**
 * Detalle de un contrato: sus datos, sus anexos y, para el propietario, editar,
 * finalizar, reemitir la contraseña del inquilino y adjuntar o borrar anexos.
 *
 * Los anexos se descargan como blob por la API autenticada (`descargarAnexo`,
 * docs/adr/0014): nunca `window.open` ni una URL con el token.
 *
 * Las acciones de propietario dependen de este contrato, no sólo del rol
 * (`actuaComoPropietario`). El backend lo vuelve a decidir (regla dura 8).
 */

const ETIQUETA_TIPO_ANEXO = { CONTRATO_FIRMADO: 'Contrato firmado', OTROSI: 'Otrosí' };
const etiquetaDeAnexo = (tipo) => ETIQUETA_TIPO_ANEXO[tipo] || tipo;

const BYTES_MAXIMOS = TAMANO_MAXIMO_ANEXO_MB * 1024 * 1024;

const Fila = ({ children }) => <div className="flex flex-col sm:flex-row gap-4 [&>*]:flex-1">{children}</div>;

/** Un dato del contrato: etiqueta arriba, valor abajo. */
const Dato = ({ etiqueta, children }) => (
    <div className="min-w-[12rem] flex-1">
        <dt className="text-xs font-medium uppercase tracking-label text-texto-label">{etiqueta}</dt>
        <dd className="m-0 mt-1 text-sm text-texto break-words">{children || '—'}</dd>
    </div>
);

const aTexto = (valor) => (valor === null || valor === undefined ? '' : String(valor));

/** Sólo lo editable (`CAMPOS_CONTRATO_EDITABLES`): las partes, el inicio y el estado no se tocan. */
const formDeContrato = (contrato) => ({
    fin: fechaDeContrato(contrato.fin) || '',
    canon: contrato.canon ?? null,
    fecha_limite_pago: aTexto(contrato.fecha_limite_pago),
    info_contrato: aTexto(contrato.info_contrato),
    nombre_deudor_solidario: aTexto(contrato.nombre_deudor_solidario),
    documento_deudor_solidario: aTexto(contrato.documento_deudor_solidario)
});

/**
 * El servicio no valida nada al editar, y un día límite fuera de rango le sale
 * como 502: todo se revisa aquí.
 */
function validarEdicion(form, inicio) {
    const errores = {};
    if (!form.fin) errores.fin = 'Indica la fecha de fin.';
    else if (inicio && form.fin <= inicio) errores.fin = 'Debe ser posterior al inicio.';
    if (form.canon === null || !(Number(form.canon) > 0)) errores.canon = 'Escribe un canon mayor que cero.';
    const dia = form.fecha_limite_pago.trim();
    if (!(/^\d{1,2}$/.test(dia) && Number(dia) >= 1 && Number(dia) <= 31)) {
        errores.fecha_limite_pago = 'Un día del mes, de 1 a 31.';
    }
    return errores;
}

function FormularioEdicion({ contrato, error, onEnviar, idFormulario }) {
    const [form, setForm] = useState(() => formDeContrato(contrato));
    const [errores, setErrores] = useState({});
    const inicio = fechaDeContrato(contrato.inicio);

    const poner = (nombre, valor) => {
        setForm((actual) => ({ ...actual, [nombre]: valor }));
        setErrores((actuales) => ({ ...actuales, [nombre]: undefined }));
    };
    const campo = (nombre) => ({
        name: nombre, value: form[nombre], error: errores[nombre], onChange: (evento) => poner(nombre, evento.target.value)
    });

    const enviar = (evento) => {
        evento.preventDefault();
        const encontrados = validarEdicion(form, inicio);
        setErrores(encontrados);
        if (Object.keys(encontrados).length === 0) onEnviar(form);
    };

    return (
        <form id={idFormulario} onSubmit={enviar} noValidate className="flex flex-col gap-4">
            <FormError error={error} />
            <Fila>
                <DateField etiqueta="Fin" name="fin" value={form.fin} error={errores.fin} min={inicio || undefined}
                    onChange={(valor) => poner('fin', valor)} />
                <MoneyField etiqueta="Canon mensual" value={form.canon} error={errores.canon} onChange={(valor) => poner('canon', valor)} />
            </Fila>
            <Input etiqueta="Día límite de pago" inputMode="numeric" ayuda="Día del mes, de 1 a 31." {...campo('fecha_limite_pago')} />
            <AreaTexto etiqueta="Condiciones particulares" {...campo('info_contrato')} />
            <Fila>
                <Input etiqueta="Deudor solidario" {...campo('nombre_deudor_solidario')} />
                <Input etiqueta="Documento del deudor" inputMode="numeric" {...campo('documento_deudor_solidario')} />
            </Fila>
        </form>
    );
}

/** Adjuntar un PDF. `tipo` es un catálogo abierto: se sugieren los conocidos y se admite cualquiera. */
function SubirAnexo({ idContrato, onSubido }) {
    const [tipo, setTipo] = useState(TIPOS_ANEXO_CONOCIDOS[0]);
    const [archivo, setArchivo] = useState(null);
    const [error, setError] = useState(null);
    const [subiendo, setSubiendo] = useState(false);
    // Cambiarla remonta el <input type=file>, que es la única forma de vaciarlo.
    const [claveArchivo, setClaveArchivo] = useState(0);

    const elegir = (evento) => {
        const elegido = evento.target.files?.[0] || null;
        setError(null);
        if (elegido && elegido.type !== 'application/pdf' && !/\.pdf$/i.test(elegido.name)) {
            setError('El archivo debe ser un PDF.');
            setArchivo(null);
        } else if (elegido && elegido.size > BYTES_MAXIMOS) {
            setError(`El archivo supera el máximo de ${TAMANO_MAXIMO_ANEXO_MB} MB.`);
            setArchivo(null);
        } else {
            setArchivo(elegido);
        }
    };

    const subir = async (evento) => {
        evento.preventDefault();
        if (!archivo) { setError('Elige un PDF.'); return; }
        if (!tipo.trim()) { setError('Indica el tipo de anexo.'); return; }
        setSubiendo(true);
        setError(null);
        try {
            await subirAnexo(idContrato, { archivo, tipo });
            setArchivo(null);
            setClaveArchivo((clave) => clave + 1);
            await onSubido();
        } catch (fallo) {
            setError(fallo);
        } finally {
            setSubiendo(false);
        }
    };

    return (
        <form onSubmit={subir} noValidate className="flex flex-col gap-3 pt-4 mt-4 border-0 border-t border-solid border-borde">
            <FormError error={error} />
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <Input etiqueta="Tipo" className="sm:w-56" list="tipos-anexo" value={tipo}
                    onChange={(evento) => setTipo(evento.target.value.toUpperCase())} />
                <datalist id="tipos-anexo">
                    {TIPOS_ANEXO_CONOCIDOS.map((valor) => <option key={valor} value={valor}>{etiquetaDeAnexo(valor)}</option>)}
                </datalist>
                <Input etiqueta={`Archivo (PDF, máx. ${TAMANO_MAXIMO_ANEXO_MB} MB)`} className="flex-1" type="file"
                    key={claveArchivo} accept="application/pdf,.pdf" onChange={elegir} />
                <Button type="submit" icono={Upload} cargando={subiendo}>Adjuntar</Button>
            </div>
        </form>
    );
}

export default function ContratoDetalle() {
    const { id } = useParams();
    const sesion = useSesion();
    const [contrato, setContrato] = useState(null);
    // `null` = no se pudieron cargar; se dice aparte, el contrato sigue en pie.
    const [anexos, setAnexos] = useState([]);
    const [errorAnexos, setErrorAnexos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState(null);
    const [aviso, setAviso] = useState('');

    // { modo: 'editar' | 'finalizar' | 'reemitir' | 'contrasena' | 'eliminar-anexo', ... } | null
    const [dialogo, setDialogo] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [errorDialogo, setErrorDialogo] = useState(null);
    const [descargando, setDescargando] = useState(null);
    const [errorDescarga, setErrorDescarga] = useState(null);

    const cargarAnexos = useCallback(async () => {
        try {
            setAnexos(await listarAnexos(id));
            setErrorAnexos(null);
        } catch (error) {
            setErrorAnexos(error);
        }
    }, [id]);

    const cargar = useCallback(async () => {
        setErrorCarga(null);
        const [con] = await Promise.allSettled([obtenerContrato(id), cargarAnexos()]);
        if (con.status === 'fulfilled') setContrato(con.value);
        else setErrorCarga(con.reason);
        setCargando(false);
    }, [id, cargarAnexos]);

    useEffect(() => { cargar(); }, [cargar]);

    const abrir = (nuevo) => { setErrorDialogo(null); setDialogo(nuevo); };
    const cerrar = () => { if (!enviando) setDialogo(null); };

    /** Ejecuta la acción del diálogo; el error se queda en el diálogo. */
    const ejecutar = async (accion) => {
        setEnviando(true);
        setErrorDialogo(null);
        try {
            await accion();
        } catch (error) {
            setErrorDialogo(error);
        } finally {
            setEnviando(false);
        }
    };

    const guardar = (datos) => ejecutar(async () => {
        await actualizarContrato(id, datos);
        setDialogo(null);
        setAviso('Contrato actualizado.');
        await cargar();
    });

    const finalizar = () => ejecutar(async () => {
        await finalizarContrato(id);
        setDialogo(null);
        setAviso('Contrato finalizado. El inmueble volverá a «Disponible» en unos segundos.');
        await cargar();
    });

    const reemitir = () => ejecutar(async () => {
        const respuesta = await reemitirContrasenaInquilino(id);
        setDialogo({ modo: 'contrasena', contrasena: respuesta.contrasena_temporal, persona: nombreDe(respuesta.inquilino) });
    });

    const borrarAnexo = () => ejecutar(async () => {
        await eliminarAnexo(id, dialogo.anexo.id_anexo);
        setDialogo(null);
        setAviso('Anexo eliminado.');
        await cargarAnexos();
    });

    const descargar = async (anexo) => {
        setDescargando(anexo.id_anexo);
        setErrorDescarga(null);
        try {
            await descargarAnexo(id, anexo);
        } catch (error) {
            // Con `responseType: 'blob'` el `{ mensaje }` llega como Blob: se lee para mostrarlo.
            const cuerpo = error.response?.data;
            if (cuerpo instanceof Blob) {
                try { setErrorDescarga(JSON.parse(await cuerpo.text())); return; } catch { /* sin cuerpo legible */ }
            }
            setErrorDescarga(error);
        } finally {
            setDescargando(null);
        }
    };

    const volver = (
        <Link to="/contratos" className="inline-flex items-center gap-1 text-sm text-indigo-medio no-underline hover:underline">
            <ArrowLeft size={16} aria-hidden="true" /> {sesion.esPropietario ? 'Contratos' : 'Mi contrato'}
        </Link>
    );

    if (cargando) return <div className="flex flex-col gap-4">{volver}<p className="m-0 text-sm text-texto-suave">Cargando contrato…</p></div>;

    if (errorCarga) {
        return (
            <div className="flex flex-col items-start gap-4">
                {volver}
                <FormError error={errorCarga} className="w-full box-border" />
                <Button variante="secundario" onClick={() => { setCargando(true); cargar(); }}>Reintentar</Button>
            </div>
        );
    }

    const propio = actuaComoPropietario(contrato, sesion);
    const activo = contrato.estado === 'activo';
    const inquilino = contrato.Inquilino;
    const inmueble = contrato.Inmueble;

    return (
        <div className="flex flex-col gap-6">
            {volver}

            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="m-0 text-2xl font-medium text-texto">{inmueble?.direccion || 'Contrato'}</h1>
                        <Badge estado={contrato.estado} />
                    </div>
                    <p className="m-0 mt-1 text-sm text-texto-suave">
                        {[ubicacionDe(inmueble), vigencia(contrato)].filter(Boolean).join(' · ')}
                    </p>
                </div>
                {propio && activo && (
                    <div className="flex flex-wrap gap-2">
                        <Button variante="secundario" icono={Pencil} onClick={() => abrir({ modo: 'editar' })}>Editar</Button>
                        <Button variante="secundario" icono={KeyRound} onClick={() => abrir({ modo: 'reemitir' })}>Contraseña del inquilino</Button>
                        <Button onClick={() => abrir({ modo: 'finalizar' })}>Finalizar</Button>
                    </div>
                )}
            </header>

            <p aria-live="polite" className="m-0 text-sm text-texto-suave empty:hidden">{aviso}</p>

            <Card titulo="Condiciones">
                <dl className="flex flex-wrap gap-x-6 gap-y-5 m-0">
                    <Dato etiqueta="Canon mensual"><span className="tabular-nums">{formatearDinero(contrato.canon)}</span></Dato>
                    <Dato etiqueta="Día límite de pago">{contrato.fecha_limite_pago ? `Día ${contrato.fecha_limite_pago} de cada mes` : null}</Dato>
                    <Dato etiqueta="Primer corte">{formatearFecha(contrato.fecha_inicio_corte)}</Dato>
                    <Dato etiqueta="Vigencia">{vigencia(contrato)}</Dato>
                </dl>
                {contrato.info_contrato && (
                    <dl className="m-0 mt-5"><Dato etiqueta="Condiciones particulares">
                        <span className="whitespace-pre-line">{contrato.info_contrato}</span>
                    </Dato></dl>
                )}
            </Card>

            <div className="flex flex-col lg:flex-row gap-6 [&>*]:flex-1">
                {propio && (
                    <Card titulo="Inquilino">
                        <dl className="flex flex-col gap-4 m-0">
                            <Dato etiqueta="Nombre">{nombreDe(inquilino)}</Dato>
                            <Dato etiqueta="Documento">{inquilino?.documento}</Dato>
                            <Dato etiqueta="Correo">{inquilino?.email}</Dato>
                            <Dato etiqueta="Teléfono">{inquilino?.telefono}</Dato>
                        </dl>
                    </Card>
                )}
                <Card titulo="Deudor solidario">
                    {contrato.nombre_deudor_solidario || contrato.documento_deudor_solidario ? (
                        <dl className="flex flex-col gap-4 m-0">
                            <Dato etiqueta="Nombre">{contrato.nombre_deudor_solidario}</Dato>
                            <Dato etiqueta="Documento">{contrato.documento_deudor_solidario}</Dato>
                        </dl>
                    ) : (
                        <p className="m-0 text-sm text-texto-suave">Este contrato no tiene deudor solidario.</p>
                    )}
                </Card>
            </div>

            <Card titulo="Anexos">
                <div className="flex flex-col gap-3">
                    <FormError error={errorAnexos} />
                    <FormError error={errorDescarga} />
                    {!errorAnexos && anexos.length === 0 && (
                        <EmptyState icono={FileText} titulo="Sin anexos"
                            descripcion={propio ? 'Adjunta el contrato firmado o un otrosí en PDF.' : 'El propietario aún no ha adjuntado documentos.'} />
                    )}
                    {anexos.length > 0 && (
                        <ul className="flex flex-col list-none m-0 p-0">
                            {anexos.map((anexo) => (
                                <li key={anexo.id_anexo}
                                    className="flex flex-wrap items-center gap-3 py-3 border-0 border-b border-solid border-borde last:border-b-0">
                                    <span className="flex items-center justify-center shrink-0 w-9 h-9 rounded-control bg-chip text-indigo-medio">
                                        <FileText size={16} aria-hidden="true" />
                                    </span>
                                    <div className="flex-1 min-w-[10rem]">
                                        <p className="m-0 text-sm font-medium text-texto">{etiquetaDeAnexo(anexo.tipo)}</p>
                                        <p className="m-0 mt-0.5 text-xs text-texto-suave">Adjuntado el {formatearFechaHora(anexo.fecha_creacion)}</p>
                                    </div>
                                    <Button variante="secundario" tamano="pequeno" icono={Download}
                                        cargando={descargando === anexo.id_anexo} onClick={() => descargar(anexo)}>Descargar</Button>
                                    {propio && (
                                        <Button variante="fantasma" tamano="pequeno" icono={Trash2}
                                            onClick={() => abrir({ modo: 'eliminar-anexo', anexo })}
                                            aria-label={`Eliminar ${etiquetaDeAnexo(anexo.tipo)}`} title="Eliminar" />
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                {propio && <SubirAnexo idContrato={id} onSubido={async () => { setAviso('Anexo adjuntado.'); await cargarAnexos(); }} />}
            </Card>

            <Modal
                abierto={dialogo?.modo === 'editar'}
                onCerrar={cerrar}
                titulo="Editar contrato"
                ancho="max-w-2xl"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button type="submit" form="formulario-edicion" cargando={enviando}>Guardar cambios</Button>
                    </>
                }
            >
                {dialogo?.modo === 'editar' && (
                    <FormularioEdicion idFormulario="formulario-edicion" contrato={contrato} error={errorDialogo} onEnviar={guardar} />
                )}
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'finalizar'}
                onCerrar={cerrar}
                titulo="Finalizar contrato"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button onClick={finalizar} cargando={enviando}>Finalizar</Button>
                    </>
                }
            >
                <div className="flex flex-col gap-3">
                    <FormError error={errorDialogo} />
                    <p className="m-0 text-sm text-texto">
                        El inmueble quedará disponible. Lo que se deba sigue pendiente de cobro.
                    </p>
                </div>
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'reemitir'}
                onCerrar={cerrar}
                titulo="Nueva contraseña temporal"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button icono={KeyRound} onClick={reemitir} cargando={enviando}>Generar</Button>
                    </>
                }
            >
                <div className="flex flex-col gap-3">
                    <FormError error={errorDialogo} />
                    <p className="m-0 text-sm text-texto">
                        Se generará una contraseña nueva para <span className="font-medium">{nombreDe(inquilino) || 'el inquilino'}</span>.
                        La anterior deja de servir y se cierran sus sesiones abiertas. Úsala si perdió la que le entregaste.
                    </p>
                </div>
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'contrasena'}
                onCerrar={() => setDialogo(null)}
                titulo="Entrega la contraseña al inquilino"
                acciones={<Button onClick={() => setDialogo(null)}>Ya la anoté</Button>}
            >
                {dialogo?.modo === 'contrasena' && <ContrasenaTemporal contrasena={dialogo.contrasena} persona={dialogo.persona} />}
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'eliminar-anexo'}
                onCerrar={cerrar}
                titulo="Eliminar anexo"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button icono={Trash2} onClick={borrarAnexo} cargando={enviando}>Eliminar</Button>
                    </>
                }
            >
                <div className="flex flex-col gap-3">
                    <FormError error={errorDialogo} />
                    <p className="m-0 text-sm text-texto">
                        ¿Eliminar <span className="font-medium">{etiquetaDeAnexo(dialogo?.anexo?.tipo)}</span>? El archivo se borra y no se puede recuperar.
                    </p>
                </div>
            </Modal>
        </div>
    );
}
