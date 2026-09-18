import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, Search, UserPlus } from 'lucide-react';

import { useSesion } from '../auth/sesion';
import { crearContrato, finalizarContrato, listarContratos } from '../features/contratos/api';
import {
    AreaTexto, ContrasenaTemporal, actuaComoPropietario, nombreDe, ubicacionDe, vigencia
} from '../features/contratos/piezas';
import { listarInmuebles } from '../features/inmuebles/api';
import { buscarPorDocumento, crearInquilino } from '../features/usuarios/api';
import {
    Badge, Button, DateField, EmptyState, FormError, Input, Modal, MoneyField, Select, Table, formatearDinero
} from '../ui';

/**
 * UI de Contratos (mockup docs/mockups/contratos.png): la lista, el alta y la
 * finalización.
 *
 * El alta sigue el endpoint real (ver `features/contratos/api.js`): el inquilino
 * se busca por documento porque `id_inquilino` es un UUID que nadie teclea, y si
 * no existe se le da de alta aquí mismo. Su contraseña temporal sale una sola vez
 * (docs/adr/0007) y se muestra al terminar.
 *
 * Las acciones de propietario dependen del contrato y no sólo del rol: quien
 * tiene los dos roles es inquilino en algunos (`actuaComoPropietario`).
 *
 * Maquetado con flex y no con `grid-cols-*`: la clase `.grid` de App.css le gana
 * a Tailwind hasta el paso 6.
 */

const FORM_VACIO = {
    id_inmueble: '', documento: '', inicio: '', fin: '', canon: null, fecha_limite_pago: '',
    fecha_inicio_corte: '', info_contrato: '', nombre_deudor_solidario: '', documento_deudor_solidario: ''
};

const ALTA_VACIA = { nombres: '', apellidos: '', email: '', telefono: '' };

/** Día del mes de una fecha `YYYY-MM-DD`, leído del texto: `new Date()` lo correría a la víspera. */
const diaDe = (fecha) => (/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? String(Number(fecha.slice(8, 10))) : '');

/**
 * Errores por campo, o `{}`. El servicio valida fechas, canon y día límite, pero
 * responde uno a la vez; aquí se señalan todos juntos.
 */
function validar(form, inquilino) {
    const errores = {};
    if (!form.id_inmueble) errores.id_inmueble = 'Elige el inmueble.';
    if (!inquilino) errores.documento = 'Busca al inquilino por su documento.';
    if (!form.inicio) errores.inicio = 'Indica la fecha de inicio.';
    if (!form.fin) errores.fin = 'Indica la fecha de fin.';
    else if (form.inicio && form.fin <= form.inicio) errores.fin = 'Debe ser posterior al inicio.';
    if (form.canon === null || !(Number(form.canon) > 0)) errores.canon = 'Escribe un canon mayor que cero.';
    const dia = form.fecha_limite_pago.trim();
    if (dia && !(/^\d{1,2}$/.test(dia) && Number(dia) >= 1 && Number(dia) <= 31)) {
        errores.fecha_limite_pago = 'Un día del mes, de 1 a 31.';
    }
    return errores;
}

function validarAlta(alta) {
    const errores = {};
    if (!alta.nombres.trim()) errores.nombres = 'Obligatorio.';
    if (!alta.apellidos.trim()) errores.apellidos = 'Obligatorio.';
    if (!/^\S+@\S+\.\S+$/.test(alta.email.trim())) errores.email = 'Escribe un correo válido.';
    return errores;
}

const Fila = ({ children }) => <div className="flex flex-col sm:flex-row gap-4 [&>*]:flex-1">{children}</div>;

const Seccion = ({ titulo, children }) => (
    <fieldset className="flex flex-col gap-4 m-0 p-0 border-0">
        <legend className="p-0 mb-3 text-sm font-medium text-texto">{titulo}</legend>
        {children}
    </fieldset>
);

/**
 * El botón de envío vive en el pie del modal: `form={idFormulario}` lo enlaza.
 * El alta del inquilino no es un <form> anidado sino botones sueltos.
 */
function FormularioContrato({ inmuebles, error, onEnviar, onContrasena, idFormulario }) {
    const [form, setForm] = useState(FORM_VACIO);
    const [errores, setErrores] = useState({});
    // null | { id, nombre }
    const [inquilino, setInquilino] = useState(null);
    // 'inicial' | 'buscando' | 'no-existe' | 'registrando'
    const [busqueda, setBusqueda] = useState('inicial');
    const [errorInquilino, setErrorInquilino] = useState(null);
    const [alta, setAlta] = useState(ALTA_VACIA);
    const [erroresAlta, setErroresAlta] = useState({});
    const [contrasena, setContrasena] = useState(null);

    const poner = (nombre, valor) => {
        setForm((actual) => ({ ...actual, [nombre]: valor }));
        setErrores((actuales) => ({ ...actuales, [nombre]: undefined }));
    };
    const campo = (nombre) => ({
        name: nombre, value: form[nombre], error: errores[nombre],
        onChange: (evento) => poner(nombre, evento.target.value)
    });

    /** El día límite se sugiere desde el inicio hasta que el propietario escribe otro. */
    const cambiarInicio = (valor) => {
        setForm((actual) => {
            const sugeridoAntes = diaDe(actual.inicio);
            const limite = !actual.fecha_limite_pago || actual.fecha_limite_pago === sugeridoAntes
                ? diaDe(valor) : actual.fecha_limite_pago;
            return { ...actual, inicio: valor, fecha_limite_pago: limite };
        });
        setErrores((actuales) => ({ ...actuales, inicio: undefined, fecha_limite_pago: undefined }));
    };

    const cambiarDocumento = (evento) => {
        poner('documento', evento.target.value);
        if (!contrasena) {
            setInquilino(null);
            setBusqueda('inicial');
        }
        setErrorInquilino(null);
    };

    const buscar = async () => {
        const documento = form.documento.trim();
        if (!documento) {
            setErrores((actuales) => ({ ...actuales, documento: 'Escribe el documento.' }));
            return;
        }
        setBusqueda('buscando');
        setErrorInquilino(null);
        try {
            const persona = await buscarPorDocumento(documento);
            if (persona) {
                setInquilino({ id: persona.id, nombre: nombreDe(persona) });
                setBusqueda('inicial');
            } else {
                setInquilino(null);
                setBusqueda('no-existe');
            }
        } catch (fallo) {
            setErrorInquilino(fallo);
            setBusqueda('inicial');
        }
    };

    const registrar = async () => {
        const encontrados = validarAlta(alta);
        setErroresAlta(encontrados);
        if (Object.keys(encontrados).length > 0) return;
        setBusqueda('registrando');
        setErrorInquilino(null);
        try {
            const respuesta = await crearInquilino({ ...alta, documento: form.documento });
            const nombre = nombreDe(respuesta.usuario);
            setInquilino({ id: respuesta.usuario.id, nombre });
            setContrasena({ contrasena: respuesta.contrasena_temporal, persona: nombre });
            onContrasena({ contrasena: respuesta.contrasena_temporal, persona: nombre });
            setBusqueda('inicial');
        } catch (fallo) {
            setErrorInquilino(fallo);
            setBusqueda('no-existe');
        }
    };

    const enviar = (evento) => {
        evento.preventDefault();
        const encontrados = validar(form, inquilino);
        setErrores(encontrados);
        // `documento` no viaja: la capa de datos recorta a `CAMPOS_CONTRATO`.
        if (Object.keys(encontrados).length === 0) onEnviar({ ...form, id_inquilino: inquilino.id });
    };

    const campoAlta = (nombre) => ({
        name: nombre, value: alta[nombre], error: erroresAlta[nombre],
        onChange: (evento) => {
            setAlta((actual) => ({ ...actual, [nombre]: evento.target.value }));
            setErroresAlta((actuales) => ({ ...actuales, [nombre]: undefined }));
        }
    });

    const opcionesInmueble = inmuebles.map((i) => ({
        valor: i.id_inmueble, texto: [i.direccion, ubicacionDe(i)].filter(Boolean).join(' · ')
    }));

    return (
        <form id={idFormulario} onSubmit={enviar} noValidate className="flex flex-col gap-6">
            <FormError error={error} />

            <Seccion titulo="Inmueble e inquilino">
                <Select etiqueta="Inmueble" vacio={inmuebles.length ? 'Selecciona…' : 'No tienes inmuebles disponibles'}
                    opciones={opcionesInmueble} disabled={!inmuebles.length} {...campo('id_inmueble')} />

                <div>
                    <div className="flex items-end gap-2">
                        <Input etiqueta="Documento del inquilino" className="flex-1" inputMode="numeric" autoComplete="off"
                            {...campo('documento')} error={undefined} onChange={cambiarDocumento} readOnly={Boolean(contrasena)}
                            onKeyDown={(evento) => { if (evento.key === 'Enter') { evento.preventDefault(); buscar(); } }} />
                        {!contrasena && (
                            <Button variante="secundario" icono={Search} onClick={buscar} cargando={busqueda === 'buscando'}>Buscar</Button>
                        )}
                    </div>
                    {errores.documento && <p role="alert" className="m-0 mt-1 text-xs text-rojo-texto">{errores.documento}</p>}
                </div>
                <FormError error={errorInquilino} />

                {inquilino && (
                    <p className="m-0 text-sm text-texto">
                        Inquilino: <span className="font-medium">{inquilino.nombre || 'registrado'}</span>
                    </p>
                )}

                {(busqueda === 'no-existe' || busqueda === 'registrando') && (
                    <div className="flex flex-col gap-4 bg-lavanda border border-solid border-borde rounded-control p-4">
                        <p className="m-0 text-sm text-texto">
                            Nadie tiene ese documento registrado. Da de alta al inquilino para firmar el contrato.
                        </p>
                        <Fila>
                            <Input etiqueta="Nombres" {...campoAlta('nombres')} />
                            <Input etiqueta="Apellidos" {...campoAlta('apellidos')} />
                        </Fila>
                        <Fila>
                            <Input etiqueta="Correo" type="email" {...campoAlta('email')} />
                            <Input etiqueta="Teléfono (opcional)" type="tel" {...campoAlta('telefono')} />
                        </Fila>
                        <div>
                            <Button variante="secundario" icono={UserPlus} onClick={registrar}
                                cargando={busqueda === 'registrando'}>Registrar inquilino</Button>
                        </div>
                    </div>
                )}

                {contrasena && <ContrasenaTemporal {...contrasena} />}
            </Seccion>

            <Seccion titulo="Condiciones">
                <Fila>
                    <DateField etiqueta="Inicio" name="inicio" value={form.inicio} error={errores.inicio} onChange={cambiarInicio} />
                    <DateField etiqueta="Fin" name="fin" value={form.fin} error={errores.fin} onChange={(valor) => poner('fin', valor)} />
                </Fila>
                <Fila>
                    <MoneyField etiqueta="Canon mensual" value={form.canon} error={errores.canon}
                        onChange={(valor) => poner('canon', valor)} />
                    <Input etiqueta="Día límite de pago" inputMode="numeric" placeholder="1 a 31"
                        ayuda="Día del mes. Se sugiere el del inicio." {...campo('fecha_limite_pago')} />
                </Fila>
                <DateField etiqueta="Primer corte (opcional)" name="fecha_inicio_corte" value={form.fecha_inicio_corte}
                    ayuda="Si lo dejas vacío, el ciclo de cobro empieza el día de inicio."
                    onChange={(valor) => poner('fecha_inicio_corte', valor)} />
                <AreaTexto etiqueta="Condiciones particulares (opcional)" {...campo('info_contrato')} />
            </Seccion>

            <Seccion titulo="Deudor solidario (opcional)">
                <Fila>
                    <Input etiqueta="Nombre" {...campo('nombre_deudor_solidario')} />
                    <Input etiqueta="Documento" inputMode="numeric" {...campo('documento_deudor_solidario')} />
                </Fila>
            </Seccion>
        </form>
    );
}

const ID_FORMULARIO = 'formulario-contrato';

export default function Contratos() {
    const sesion = useSesion();
    const [contratos, setContratos] = useState([]);
    // `null` = no se pudieron cargar; el formulario lo dice.
    const [inmuebles, setInmuebles] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState(null);
    const [aviso, setAviso] = useState('');

    // { modo: 'crear' } | { modo: 'finalizar', contrato } | { modo: 'contrasena', contrasena, persona } | null
    const [dialogo, setDialogo] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [errorDialogo, setErrorDialogo] = useState(null);
    // La del inquilino recién dado de alta, para mostrarla otra vez al firmar.
    const [contrasenaNueva, setContrasenaNueva] = useState(null);

    const { esPropietario } = sesion;

    const cargar = useCallback(async () => {
        setErrorCarga(null);
        // Al inquilino no se le piden los inmuebles: la matriz se los niega.
        const [con, inm] = await Promise.allSettled([
            listarContratos(),
            esPropietario ? listarInmuebles() : Promise.resolve([])
        ]);
        if (con.status === 'fulfilled') setContratos(con.value);
        else setErrorCarga(con.reason);
        setInmuebles(inm.status === 'fulfilled' ? inm.value : null);
        setCargando(false);
    }, [esPropietario]);

    useEffect(() => { cargar(); }, [cargar]);

    /**
     * Disponibles para firmar. El estado del inmueble converge unos segundos
     * después de firmar (regla dura 9), así que también se descartan los que ya
     * tienen un contrato activo en la lista.
     */
    const disponibles = useMemo(() => {
        const ocupados = new Set(contratos.filter((c) => c.estado === 'activo').map((c) => c.id_inmueble));
        return (inmuebles || []).filter((i) => i.estado === 'disponible' && !ocupados.has(i.id_inmueble));
    }, [inmuebles, contratos]);

    const algunoPropio = contratos.some((c) => actuaComoPropietario(c, sesion));

    const abrir = (nuevo) => { setErrorDialogo(null); setDialogo(nuevo); };
    const cerrar = () => { if (!enviando) setDialogo(null); };
    const abrirAlta = () => { setContrasenaNueva(null); abrir({ modo: 'crear' }); };

    const crear = async (datos) => {
        setEnviando(true);
        setErrorDialogo(null);
        try {
            await crearContrato(datos);
            setAviso('Contrato firmado. El inmueble pasará a «Arrendado» en unos segundos.');
            setDialogo(contrasenaNueva ? { modo: 'contrasena', ...contrasenaNueva } : null);
            setContrasenaNueva(null);
            await cargar();
        } catch (error) {
            setErrorDialogo(error);
        } finally {
            setEnviando(false);
        }
    };

    const finalizar = async () => {
        setEnviando(true);
        setErrorDialogo(null);
        try {
            await finalizarContrato(dialogo.contrato.id_contrato);
            setDialogo(null);
            setAviso('Contrato finalizado. El inmueble volverá a «Disponible» en unos segundos.');
            await cargar();
        } catch (error) {
            setErrorDialogo(error);
        } finally {
            setEnviando(false);
        }
    };

    const columnas = [
        {
            clave: 'inmueble', titulo: 'Inmueble',
            render: (c) => (
                <div className="min-w-[10rem]">
                    <Link to={`/contratos/${c.id_contrato}`} className="text-sm font-medium text-texto no-underline hover:underline">
                        {c.Inmueble?.direccion || 'Inmueble sin datos'}
                    </Link>
                    {ubicacionDe(c.Inmueble) && <p className="m-0 mt-0.5 text-xs text-texto-suave">{ubicacionDe(c.Inmueble)}</p>}
                </div>
            )
        },
        algunoPropio && {
            clave: 'inquilino', titulo: 'Inquilino',
            render: (c) => (actuaComoPropietario(c, sesion) ? nombreDe(c.Inquilino) || '—' : 'Tú')
        },
        { clave: 'vigencia', titulo: 'Vigencia', render: (c) => <span className="whitespace-nowrap">{vigencia(c)}</span> },
        { clave: 'canon', titulo: 'Canon', alinear: 'derecha', render: (c) => formatearDinero(c.canon) },
        { clave: 'estado', titulo: 'Estado', render: (c) => <Badge estado={c.estado} /> },
        {
            clave: 'acciones', titulo: 'Acciones', alinear: 'derecha',
            render: (c) => (
                <div className="flex justify-end gap-1">
                    <Link to={`/contratos/${c.id_contrato}`}
                        className="inline-flex items-center h-8 px-3 text-xs font-medium text-indigo-medio no-underline rounded-control hover:bg-lavanda">
                        Ver
                    </Link>
                    {actuaComoPropietario(c, sesion) && c.estado === 'activo' && (
                        <Button variante="fantasma" tamano="pequeno" onClick={() => abrir({ modo: 'finalizar', contrato: c })}>
                            Finalizar
                        </Button>
                    )}
                </div>
            )
        }
    ].filter(Boolean);

    // Mismo nombre que la entrada del menú (shell/navegacion.js): «Mi contrato» sólo para quien es sólo inquilino.
    const titulo = esPropietario ? 'Contratos de arrendamiento' : 'Mi contrato';
    const subtitulo = esPropietario
        ? 'Gestiona los contratos de tus inmuebles.'
        : 'Consulta tu contrato y descarga sus anexos.';

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="m-0 text-2xl font-medium text-texto">{titulo}</h1>
                    <p className="m-0 mt-1 text-sm text-texto-suave">{subtitulo}</p>
                </div>
                {esPropietario && <Button icono={Plus} onClick={() => abrirAlta()}>Nuevo contrato</Button>}
            </header>

            <p aria-live="polite" className="m-0 text-sm text-texto-suave empty:hidden">{aviso}</p>

            {errorCarga ? (
                <div className="flex flex-col items-start gap-3">
                    <FormError error={errorCarga} className="w-full box-border" />
                    <Button variante="secundario" onClick={() => { setCargando(true); cargar(); }}>Reintentar</Button>
                </div>
            ) : (
                <div className="bg-superficie border border-solid border-borde rounded-tarjeta">
                    <Table
                        columnas={columnas}
                        filas={contratos}
                        claveFila="id_contrato"
                        cargando={cargando}
                        vacio={
                            <EmptyState
                                icono={FileText}
                                titulo={esPropietario ? 'Aún no tienes contratos' : 'No tienes contratos'}
                                descripcion={esPropietario
                                    ? 'Firma un contrato sobre uno de tus inmuebles disponibles.'
                                    : 'Cuando un propietario firme un contrato contigo, aparecerá aquí.'}
                                accion={esPropietario && <Button icono={Plus} onClick={() => abrirAlta()}>Nuevo contrato</Button>}
                            />
                        }
                    />
                </div>
            )}

            <Modal
                abierto={dialogo?.modo === 'crear'}
                onCerrar={cerrar}
                titulo="Nuevo contrato"
                ancho="max-w-2xl"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button type="submit" form={ID_FORMULARIO} cargando={enviando}>Firmar contrato</Button>
                    </>
                }
            >
                {dialogo?.modo === 'crear' && (
                    <div className="flex flex-col gap-4">
                        {inmuebles === null && <FormError error="No se pudieron cargar tus inmuebles. Cierra e inténtalo de nuevo." />}
                        <FormularioContrato
                            idFormulario={ID_FORMULARIO}
                            inmuebles={disponibles}
                            error={errorDialogo}
                            onEnviar={crear}
                            onContrasena={setContrasenaNueva}
                        />
                    </div>
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
                        ¿Finalizar el contrato de <span className="font-medium">{dialogo?.contrato?.Inmueble?.direccion || 'este inmueble'}</span>?
                        El inmueble quedará disponible. Lo que se deba sigue pendiente de cobro.
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
        </div>
    );
}
