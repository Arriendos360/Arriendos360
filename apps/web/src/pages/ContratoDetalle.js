import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, KeyRound, Pencil, Send, Trash2, TrendingUp, Upload } from 'lucide-react';
import { MOTIVOS_CANCELACION, TAMANO_MAXIMO_ANEXO_MB, TIPOS_ANEXO_CONOCIDOS } from 'arriendos360-contracts';

import { useSesion } from '../auth/sesion';
import {
    actualizarContrato, cancelarContrato, descargarAnexo, descargarCartaPreaviso, descargarContratoGenerado, eliminarAnexo,
    enviarPreaviso, fechaDeContrato, finalizarContrato, listarAnexos, listarHistorial, obtenerContrato,
    reemitirContrasenaInquilino, subirAnexo
} from '../features/contratos/api';
import {
    OPCIONES_A_CARGO_DE, filaDeHistorial, indemnizacionSugerida, motivosPara, primerInicioLibre
} from '../features/contratos/estado';
import { crearCuentaCobro, cuentasDeContrato } from '../features/pagos/api';
import { resumenDeAjuste } from '../features/contratos/ajuste';
import { AVISO_SERVICIO_POSTAL, resumenDePreaviso } from '../features/contratos/preaviso';
import {
    AlertaMora, AreaTexto, ContrasenaTemporal, actuaComoPropietario, nombreDe, nombreDeInmueble, ubicacionDe, vigencia
} from '../features/contratos/piezas';
import {
    Badge, Button, Card, DateField, EmptyState, FormError, Input, Modal, MoneyField, Select, aDecimal, formatearDinero,
    formatearFecha, formatearFechaHora, hoyEnBogota
} from '../ui';
import { erroresDelServidor } from '../ui/validacion';

/**
 * Detalle de un contrato: sus datos, sus anexos y, para el propietario, editar,
 * finalizar, reemitir la contraseña del inquilino y adjuntar o borrar anexos.
 *
 * Los anexos y el contrato generado se descargan como blob por la API
 * autenticada: nunca `window.open` ni una URL con el token.
 *
 * Las acciones de propietario dependen de este contrato, no sólo del rol
 * (`actuaComoPropietario`). El backend lo vuelve a decidir.
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
 * como 502: todo se revisa aquí. Con la ventana de ajuste abierta, un canon nuevo es
 * el ajuste por IPC y no puede pasar del sugerido.
 */
function validarEdicion(form, contrato) {
    const errores = {};
    const inicio = fechaDeContrato(contrato.inicio);
    const ajuste = contrato.ajuste_canon;
    if (!form.fin) errores.fin = 'Indica la fecha de fin.';
    else if (inicio && form.fin <= inicio) errores.fin = 'Debe ser posterior al inicio.';
    else if (form.fin !== fechaDeContrato(contrato.fin) && form.fin <= hoyEnBogota()) errores.fin = 'Debe ser posterior a hoy.';
    if (form.canon === null || !(Number(form.canon) > 0)) errores.canon = 'Escribe un canon mayor que cero.';
    else if (ajuste?.en_ventana && Number(form.canon) !== Number(contrato.canon) && Number(form.canon) > ajuste.canon_sugerido) {
        errores.canon = `No puede superar ${formatearDinero(ajuste.canon_sugerido)}, el tope del IPC de ${ajuste.anio_ipc}.`;
    }
    const dia = form.fecha_limite_pago.trim();
    if (!(/^\d{1,2}$/.test(dia) && Number(dia) >= 1 && Number(dia) <= 31)) {
        errores.fecha_limite_pago = 'Un día del mes, de 1 a 31.';
    }
    return errores;
}

/** `canonInicial` lo pone «Aplicar ajuste» con el canon sugerido. */
function FormularioEdicion({ contrato, canonInicial, error, onEnviar, idFormulario }) {
    const [form, setForm] = useState(() => ({
        ...formDeContrato(contrato),
        ...(canonInicial !== undefined && { canon: String(canonInicial) })
    }));
    const [errores, setErrores] = useState({});
    const inicio = fechaDeContrato(contrato.inicio);
    const servidor = erroresDelServidor(error, Object.keys(form));
    const enVentana = contrato.ajuste_canon?.en_ventana;
    // El término inicial mide la prórroga: `fin` sólo se corrige mientras corre y sin preaviso.
    const finEditable = contrato.situacion === 'vigente' && !contrato.preaviso?.enviado;

    const poner = (nombre, valor) => {
        setForm((actual) => ({ ...actual, [nombre]: valor }));
        setErrores((actuales) => ({ ...actuales, [nombre]: undefined }));
    };
    const errorDe = (nombre) => errores[nombre] ?? servidor?.errores[nombre];
    const campo = (nombre) => ({
        name: nombre, value: form[nombre], error: errorDe(nombre), onChange: (evento) => poner(nombre, evento.target.value)
    });

    const enviar = (evento) => {
        evento.preventDefault();
        const encontrados = validarEdicion(form, contrato);
        setErrores(encontrados);
        if (Object.keys(encontrados).length === 0) onEnviar(form);
    };

    return (
        <form id={idFormulario} onSubmit={enviar} noValidate className="flex flex-col gap-4">
            <FormError error={servidor ? servidor.general : error} />
            {enVentana && (
                <p className="m-0 text-sm text-texto-suave">
                    Cambiar el canon es el ajuste anual por IPC: hasta {formatearDinero(contrato.ajuste_canon.canon_sugerido)}.
                    Al guardar, el inquilino recibirá el aviso formal.
                </p>
            )}
            <Fila>
                <DateField etiqueta="Fin" name="fin" value={form.fin} error={errorDe('fin')} min={inicio || undefined}
                    disabled={!finEditable} ayuda={finEditable ? undefined : 'Sólo se cambia durante el término inicial y sin preaviso.'}
                    onChange={(valor) => poner('fin', valor)} />
                <MoneyField etiqueta="Canon mensual" value={form.canon} error={errorDe('canon')} onChange={(valor) => poner('canon', valor)} />
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

/**
 * Cancelar: el motivo prellena la indemnización sugerida y quién la paga, los dos editables porque
 * la indemnización es pactable. La unilateral del arrendador sólo se ofrece en la prórroga.
 */
function FormularioCancelacion({ contrato, error, onEnviar, idFormulario }) {
    const [form, setForm] = useState({ motivo: '', indemnizacion: null, indemnizacion_a_cargo_de: '' });
    const [errores, setErrores] = useState({});
    const servidor = erroresDelServidor(error, Object.keys(form));
    const motivo = MOTIVOS_CANCELACION[form.motivo];
    const errorDe = (nombre) => errores[nombre] ?? servidor?.errores[nombre];

    const elegirMotivo = (valor) => {
        const sugerida = indemnizacionSugerida(valor, contrato.canon);
        setForm({ motivo: valor, indemnizacion: sugerida.valor, indemnizacion_a_cargo_de: sugerida.a_cargo_de });
        setErrores({});
    };
    const poner = (nombre, valor) => {
        setForm((actual) => ({ ...actual, [nombre]: valor }));
        setErrores((actuales) => ({ ...actuales, [nombre]: undefined }));
    };

    const enviar = (evento) => {
        evento.preventDefault();
        const encontrados = {};
        const valor = aDecimal(form.indemnizacion);
        if (!form.motivo) encontrados.motivo = 'Elige el motivo.';
        if (valor === null || Number(valor) < 0) encontrados.indemnizacion = 'Escribe un valor de 0 o más.';
        else if (Number(valor) > 0 && !form.indemnizacion_a_cargo_de) encontrados.indemnizacion_a_cargo_de = 'Indica quién la paga.';
        setErrores(encontrados);
        if (Object.keys(encontrados).length === 0) onEnviar(form);
    };

    return (
        <form id={idFormulario} onSubmit={enviar} noValidate className="flex flex-col gap-4">
            <FormError error={servidor ? servidor.general : error} />
            <p className="m-0 text-sm text-texto">
                ¿Seguro que quieres cancelar el contrato? No se puede deshacer. El inmueble quedará disponible.
            </p>
            <Select etiqueta="Motivo" vacio="Selecciona…" opciones={motivosPara(contrato.situacion)} value={form.motivo}
                error={errorDe('motivo')} onChange={(evento) => elegirMotivo(evento.target.value)} />
            {motivo && (
                <p className="m-0 text-xs text-texto-suave">
                    Según el {motivo.referencia}, la indemnización sugerida es de {motivo.canones_sugeridos} cánones
                    ({formatearDinero(indemnizacionSugerida(form.motivo, contrato.canon).valor)}). Es pactable: puedes cambiarla.
                </p>
            )}
            <Fila>
                <MoneyField etiqueta="Indemnización" value={form.indemnizacion} error={errorDe('indemnizacion')}
                    onChange={(valor) => poner('indemnizacion', valor)} />
                <Select etiqueta="A cargo de" vacio="Nadie" opciones={OPCIONES_A_CARGO_DE} value={form.indemnizacion_a_cargo_de}
                    error={errorDe('indemnizacion_a_cargo_de')} onChange={(evento) => poner('indemnizacion_a_cargo_de', evento.target.value)} />
            </Fila>
            <AlertaMora idContrato={contrato.id_contrato} />
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
    // La búsqueda del listado, para volver a él con sus filtros.
    const location = useLocation();
    const [contrato, setContrato] = useState(null);
    // `null` = no se pudieron cargar; se dice aparte, el contrato sigue en pie.
    const [anexos, setAnexos] = useState([]);
    const [errorAnexos, setErrorAnexos] = useState(null);
    const [historial, setHistorial] = useState([]);
    const [errorHistorial, setErrorHistorial] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState(null);
    const [aviso, setAviso] = useState('');

    // { modo: 'editar' | 'finalizar' | 'cancelar' | 'cobrar' | 'reemitir' | 'contrasena' | 'eliminar-anexo' | 'preaviso', ... } | null
    const [dialogo, setDialogo] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [errorDialogo, setErrorDialogo] = useState(null);
    const [descargando, setDescargando] = useState(null);
    // `{ clave, error }`: la tarjeta del preaviso y la de anexos muestran cada una el suyo.
    const [errorDescarga, setErrorDescarga] = useState(null);

    const cargarAnexos = useCallback(async () => {
        try {
            setAnexos(await listarAnexos(id));
            setErrorAnexos(null);
        } catch (error) {
            setErrorAnexos(error);
        }
    }, [id]);

    const cargarHistorial = useCallback(async () => {
        try {
            setHistorial(await listarHistorial(id));
            setErrorHistorial(null);
        } catch (error) {
            setErrorHistorial(error);
        }
    }, [id]);

    const cargar = useCallback(async () => {
        setErrorCarga(null);
        const [con] = await Promise.allSettled([obtenerContrato(id), cargarAnexos(), cargarHistorial()]);
        if (con.status === 'fulfilled') setContrato(con.value);
        else setErrorCarga(con.reason);
        setCargando(false);
    }, [id, cargarAnexos, cargarHistorial]);

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
        const respuesta = await actualizarContrato(id, datos);
        setDialogo(null);
        setAviso(respuesta?.rige_desde
            ? `Ajuste aplicado: rige desde el ${formatearFecha(respuesta.rige_desde)} y se avisó al inquilino.`
            : 'Contrato actualizado.');
        await cargar();
    });

    const finalizar = () => ejecutar(async () => {
        await finalizarContrato(id);
        setDialogo(null);
        setAviso('Contrato finalizado. El inmueble volverá a «Disponible» en unos segundos.');
        await cargar();
    });

    /** Si la indemnización la paga el inquilino, ofrece crear su cobro; si la paga el propietario, sólo la informa. */
    const cancelar = (datos) => ejecutar(async () => {
        await cancelarContrato(id, datos);
        await cargar();
        const valor = Number(aDecimal(datos.indemnizacion));
        if (valor > 0 && datos.indemnizacion_a_cargo_de === 'INQUILINO') {
            setDialogo({ modo: 'cobrar', valor: datos.indemnizacion, motivo: datos.motivo });
            return;
        }
        setDialogo(null);
        setAviso(valor > 0
            ? `Contrato cancelado. La indemnización de ${formatearDinero(datos.indemnizacion)} queda a cargo del arrendador: el sistema no la cobra.`
            : 'Contrato cancelado. El inmueble volverá a «Disponible» en unos segundos.');
    });

    // Sin `fin`: el servicio lo deriva del día de corte, y la tabla exige que sea posterior a `inicio`.
    const cobrarIndemnizacion = () => ejecutar(async () => {
        await crearCuentaCobro({
            id_contrato: id,
            valor: dialogo.valor,
            inicio: primerInicioLibre(await cuentasDeContrato(id), hoyEnBogota()),
            detalle: `Indemnización por terminación del contrato: ${MOTIVOS_CANCELACION[dialogo.motivo].etiqueta}`
        });
        setDialogo(null);
        setAviso('Contrato cancelado y cuenta de cobro de la indemnización creada: el inquilino recibirá el aviso.');
    });

    const reemitir = () => ejecutar(async () => {
        const respuesta = await reemitirContrasenaInquilino(id);
        setDialogo({ modo: 'contrasena', contrasena: respuesta.contrasena_temporal, persona: nombreDe(respuesta.inquilino) });
    });

    /** El propietario elige la causal; el inquilino no invoca ninguna. */
    const preavisar = () => {
        const comoPropietario = actuaComoPropietario(contrato, sesion);
        if (comoPropietario && !dialogo.causal) {
            setDialogo((actual) => ({ ...actual, faltaCausal: true }));
            return;
        }
        ejecutar(async () => {
            await enviarPreaviso(id, comoPropietario ? dialogo.causal : undefined);
            setDialogo(null);
            setAviso('Preaviso registrado y avisado a la otra parte. Descarga la carta y envíala por correo certificado.');
            await cargar();
        });
    };

    const borrarAnexo = () => ejecutar(async () => {
        await eliminarAnexo(id, dialogo.anexo.id_anexo);
        setDialogo(null);
        setAviso('Anexo eliminado.');
        await cargarAnexos();
    });

    /** `clave` marca qué botón muestra la espera: el id del anexo o `'contrato'`. */
    const descargar = async (clave, descarga) => {
        setDescargando(clave);
        setErrorDescarga(null);
        try {
            await descarga();
        } catch (error) {
            // Con `responseType: 'blob'` el `{ mensaje }` llega como Blob: se lee para mostrarlo.
            const cuerpo = error.response?.data;
            if (cuerpo instanceof Blob) {
                try { setErrorDescarga({ clave, error: JSON.parse(await cuerpo.text()) }); return; } catch { /* sin cuerpo legible */ }
            }
            setErrorDescarga({ clave, error });
        } finally {
            setDescargando(null);
        }
    };

    const volver = (
        <Link to={`/contratos${location.state?.busqueda ?? ''}`} className="inline-flex items-center gap-1 text-sm text-indigo-medio no-underline hover:underline">
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
    const ajuste = resumenDeAjuste(contrato.ajuste_canon);
    const preaviso = resumenDePreaviso(contrato.preaviso);
    const servidorPreaviso = dialogo?.modo === 'preaviso' ? erroresDelServidor(errorDialogo, ['causal']) : null;

    return (
        <div className="flex flex-col gap-6">
            {volver}

            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="m-0 text-2xl font-medium text-texto">{nombreDeInmueble(inmueble) || 'Contrato'}</h1>
                        <Badge estado={contrato.situacion ?? contrato.estado} />
                    </div>
                    <p className="m-0 mt-1 text-sm text-texto-suave">
                        {[inmueble?.direccion, ubicacionDe(inmueble), vigencia(contrato)].filter(Boolean).join(' · ')}
                    </p>
                </div>
                {propio && activo && (
                    <div className="flex flex-wrap gap-2">
                        <Button variante="secundario" icono={Pencil} onClick={() => abrir({ modo: 'editar' })}>Editar</Button>
                        <Button variante="secundario" icono={KeyRound} onClick={() => abrir({ modo: 'reemitir' })}>Contraseña del inquilino</Button>
                        <Button variante="secundario" onClick={() => abrir({ modo: 'cancelar' })}>Cancelar contrato</Button>
                        {contrato.situacion === 'vencido_con_preaviso' && (
                            <Button onClick={() => abrir({ modo: 'finalizar' })}>Finalizar</Button>
                        )}
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

            {propio && ajuste && (
                <Card titulo="Ajuste de canon (IPC)"
                    acciones={ajuste.puedeAplicar && activo && (
                        <Button tamano="pequeno" icono={TrendingUp} onClick={() => abrir({ modo: 'editar', canon: ajuste.sugerido })}>
                            Aplicar ajuste
                        </Button>
                    )}>
                    <dl className="flex flex-wrap gap-x-6 gap-y-5 m-0">
                        <Dato etiqueta="Fecha de ajuste">{ajuste.fecha}</Dato>
                        <Dato etiqueta="IPC aplicable">{ajuste.ipc}</Dato>
                        <Dato etiqueta="Canon actual"><span className="tabular-nums">{formatearDinero(contrato.canon)}</span></Dato>
                        <Dato etiqueta="Canon sugerido">
                            {ajuste.sugerido !== null && <span className="tabular-nums">{formatearDinero(ajuste.sugerido)}</span>}
                        </Dato>
                    </dl>
                    <p className="m-0 mt-4 text-sm text-texto-suave">{ajuste.estado}</p>
                </Card>
            )}

            {preaviso && (
                <Card titulo="Preaviso de terminación"
                    acciones={preaviso.puedeEnviar ? (
                        <Button tamano="pequeno" icono={Send} onClick={() => abrir({ modo: 'preaviso', causal: '' })}>
                            Enviar preaviso
                        </Button>
                    ) : preaviso.enviado && (
                        <Button variante="secundario" tamano="pequeno" icono={Download} cargando={descargando === 'preaviso'}
                            onClick={() => descargar('preaviso', () => descargarCartaPreaviso(id))}>
                            Descargar carta
                        </Button>
                    )}>
                    <dl className="flex flex-wrap gap-x-6 gap-y-5 m-0">
                        <Dato etiqueta="Vencimiento">{preaviso.vencimiento}</Dato>
                        <Dato etiqueta="Fecha límite del preaviso">
                            <span className={preaviso.destacarLimite ? 'font-medium text-ambar-texto' : undefined}>{preaviso.limite}</span>
                        </Dato>
                    </dl>
                    <p className="m-0 mt-4 text-sm text-texto">{preaviso.estado}</p>
                    {(preaviso.puedeEnviar || preaviso.enviado) && (
                        <p className="m-0 mt-2 text-xs text-texto-suave">{AVISO_SERVICIO_POSTAL}</p>
                    )}
                    <FormError error={errorDescarga?.clave === 'preaviso' ? errorDescarga.error : null} className="mt-3" />
                </Card>
            )}

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

            <Card titulo="Anexos"
                acciones={
                    <Button variante="secundario" tamano="pequeno" icono={Download} cargando={descargando === 'contrato'}
                        onClick={() => descargar('contrato', () => descargarContratoGenerado(id))}>
                        Generar contrato
                    </Button>
                }>
                <div className="flex flex-col gap-3">
                    <FormError error={errorAnexos} />
                    <FormError error={errorDescarga?.clave === 'preaviso' ? null : errorDescarga?.error} />
                    {!errorAnexos && anexos.length === 0 && (
                        <EmptyState icono={FileText} titulo="Sin anexos"
                            descripcion={propio ? 'Genera el contrato, fírmalo y adjúntalo aquí en PDF.' : 'El propietario aún no ha adjuntado documentos.'} />
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
                                        cargando={descargando === anexo.id_anexo}
                                        onClick={() => descargar(anexo.id_anexo, () => descargarAnexo(id, anexo))}>Descargar</Button>
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

            <Card titulo="Historial de cambios">
                <FormError error={errorHistorial} />
                {!errorHistorial && historial.length === 0 && (
                    <p className="m-0 text-sm text-texto-suave">Aún no hay cambios registrados.</p>
                )}
                {historial.length > 0 && (
                    <ul className="flex flex-col list-none m-0 p-0">
                        {historial.map((fila) => {
                            const { fecha, campo, anterior, nuevo, detalle } = filaDeHistorial(fila);
                            return (
                                <li key={fila.id_historial} className="py-3 border-0 border-b border-solid border-borde last:border-b-0">
                                    <p className="m-0 text-sm text-texto">
                                        <span className="font-medium">{campo}:</span> {anterior} → {nuevo}
                                    </p>
                                    <p className="m-0 mt-0.5 text-xs text-texto-suave">{fecha}{detalle && ` · ${detalle}`}</p>
                                </li>
                            );
                        })}
                    </ul>
                )}
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
                    <FormularioEdicion idFormulario="formulario-edicion" contrato={contrato} canonInicial={dialogo.canon}
                        error={errorDialogo} onEnviar={guardar} />
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
                {dialogo?.modo === 'finalizar' && (
                    <div className="flex flex-col gap-3">
                        <FormError error={errorDialogo} />
                        <p className="m-0 text-sm text-texto">
                            ¿Seguro que quieres finalizar el contrato? No se puede deshacer. El inmueble quedará disponible.
                        </p>
                        <AlertaMora idContrato={id} />
                    </div>
                )}
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'cancelar'}
                onCerrar={cerrar}
                titulo="Cancelar contrato"
                ancho="max-w-2xl"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Volver</Button>
                        <Button type="submit" form="formulario-cancelacion" cargando={enviando}>Cancelar contrato</Button>
                    </>
                }
            >
                {dialogo?.modo === 'cancelar' && (
                    <FormularioCancelacion idFormulario="formulario-cancelacion" contrato={contrato} error={errorDialogo}
                        onEnviar={cancelar} />
                )}
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'cobrar'}
                onCerrar={cerrar}
                titulo="Cobrar la indemnización"
                acciones={
                    <>
                        <Button variante="secundario" onClick={() => { setDialogo(null); setAviso('Contrato cancelado.'); }}
                            disabled={enviando}>Ahora no</Button>
                        <Button onClick={cobrarIndemnizacion} cargando={enviando}>Crear cuenta de cobro de la indemnización</Button>
                    </>
                }
            >
                {dialogo?.modo === 'cobrar' && (
                    <div className="flex flex-col gap-3">
                        <FormError error={errorDialogo} />
                        <p className="m-0 text-sm text-texto">
                            El contrato quedó cancelado. La indemnización de <span className="font-medium">{formatearDinero(dialogo.valor)}</span> queda
                            a cargo del arrendatario: ¿creas su cuenta de cobro? Se le avisará como a cualquier cobro, y también puedes crearla
                            después desde Pagos.
                        </p>
                    </div>
                )}
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
                abierto={dialogo?.modo === 'preaviso'}
                onCerrar={cerrar}
                titulo="Enviar preaviso"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button icono={Send} onClick={preavisar} cargando={enviando}>Enviar preaviso</Button>
                    </>
                }
            >
                {dialogo?.modo === 'preaviso' && (
                    <div className="flex flex-col gap-3">
                        <FormError error={servidorPreaviso ? servidorPreaviso.general : errorDialogo} />
                        <p className="m-0 text-sm text-texto">
                            Avisarás a {propio ? 'tu arrendatario' : 'tu arrendador'} que el contrato no se renovará y termina al
                            vencer, el <span className="font-medium">{preaviso.vencimiento}</span>. No se puede deshacer.
                        </p>
                        {propio && (
                            <Select etiqueta="Causal" vacio="Selecciona…" opciones={preaviso.causales} value={dialogo.causal}
                                error={dialogo.faltaCausal ? 'Elige la causal.' : servidorPreaviso?.errores.causal}
                                onChange={(evento) => setDialogo((actual) => ({ ...actual, causal: evento.target.value, faltaCausal: false }))} />
                        )}
                        <p className="m-0 text-xs text-texto-suave">{AVISO_SERVICIO_POSTAL}</p>
                    </div>
                )}
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
