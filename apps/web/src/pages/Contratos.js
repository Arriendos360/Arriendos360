import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, Search, UserPlus } from 'lucide-react';

import { useSesion } from '../auth/sesion';
import { crearContrato, finalizarContrato, listarContratos } from '../features/contratos/api';
import {
    AlertaMora, AreaTexto, ContrasenaTemporal, actuaComoPropietario, nombreDe, nombreDeInmueble, ubicacionDe, vigencia
} from '../features/contratos/piezas';
import { errorDeDocumento, validarAlta, validarFormularioContrato } from '../features/contratos/reglas';
import { listarInmuebles } from '../features/inmuebles/api';
import { buscarPorDocumento, crearInquilino } from '../features/usuarios/api';
import {
    Badge, Button, DateField, EmptyState, FormError, Input, Modal, MoneyField, Select, Table, formatearDinero
} from '../ui';
import { useValidacion } from '../ui/validacion';

/**
 * Contratos: la lista, el alta y la
 * finalización.
 *
 * En el alta, el inquilino se busca por documento y, si no existe, se le da de
 * alta aquí mismo; su contraseña temporal se muestra una sola vez al terminar.
 *
 * Las acciones de propietario dependen del contrato y no sólo del rol: quien
 * tiene los dos roles es inquilino en algunos (`actuaComoPropietario`).
 */

const FORM_VACIO = {
    id_inmueble: '', documento: '', inicio: '', fin: '', canon: null, fecha_limite_pago: '',
    fecha_inicio_corte: '', info_contrato: '', nombre_deudor_solidario: '', documento_deudor_solidario: ''
};

/** Los campos del contrato que pueden traer error; `info_contrato` es texto libre. */
const CAMPOS_CON_ERROR = Object.keys(FORM_VACIO).filter((campo) => campo !== 'info_contrato');

const ALTA_VACIA = { nombres: '', apellidos: '', email: '', telefono: '' };

/** `documento` es el del contrato: su error se pinta bajo el documento del inquilino. */
const CAMPOS_ALTA = [...Object.keys(ALTA_VACIA), 'documento'];

/** Día del mes de una fecha `YYYY-MM-DD`, leído del texto: `new Date()` lo correría a la víspera. */
const diaDe = (fecha) => (/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? String(Number(fecha.slice(8, 10))) : '');

const Fila = ({ children }) => <div className="flex flex-col sm:flex-row gap-4 [&>*]:flex-1">{children}</div>;

const Seccion = ({ titulo, children }) => (
    <fieldset className="flex flex-col gap-4 m-0 p-0 border-0">
        <legend className="p-0 mb-3 text-sm font-medium text-texto">{titulo}</legend>
        {children}
    </fieldset>
);

/**
 * El botón de envío vive en el pie del modal: `form={idFormulario}` lo enlaza, y
 * `onErrores` le avisa al padre para deshabilitarlo. `onEnviar` devuelve el error
 * de la API, o `null`, para pintarlo aquí bajo su campo.
 * El alta del inquilino no es un <form> anidado sino botones sueltos.
 */
function FormularioContrato({ inmuebles, onEnviar, onContrasena, onErrores, idFormulario }) {
    const [form, setForm] = useState(FORM_VACIO);
    const [error, setError] = useState(null);
    // null | { id, nombre }
    const [inquilino, setInquilino] = useState(null);
    // 'inicial' | 'buscando' | 'no-existe' | 'registrando'
    const [busqueda, setBusqueda] = useState('inicial');
    const [errorInquilino, setErrorInquilino] = useState(null);
    const [alta, setAlta] = useState(ALTA_VACIA);
    const [contrasena, setContrasena] = useState(null);
    const validacion = useValidacion((datos) => validarFormularioContrato(datos, inquilino), CAMPOS_CON_ERROR);
    const validacionAlta = useValidacion((datos) => validarAlta({ ...datos, documento: form.documento }), CAMPOS_ALTA);

    useEffect(() => { onErrores(validacion.hayErrores); }, [validacion.hayErrores, onErrores]);

    const poner = (nombre, valor) => {
        setForm((actual) => ({ ...actual, [nombre]: valor }));
        validacion.limpiar(nombre);
    };
    const alSalir = (nombre) => () => validacion.alSalir(nombre, form);
    const campo = (nombre) => ({
        name: nombre, value: form[nombre], error: validacion.errores[nombre],
        onChange: (evento) => poner(nombre, evento.target.value),
        onBlur: alSalir(nombre)
    });

    /** El día límite se sugiere desde el inicio hasta que el propietario escribe otro. */
    const cambiarInicio = (valor) => {
        setForm((actual) => {
            const sugeridoAntes = diaDe(actual.inicio);
            const limite = !actual.fecha_limite_pago || actual.fecha_limite_pago === sugeridoAntes
                ? diaDe(valor) : actual.fecha_limite_pago;
            return { ...actual, inicio: valor, fecha_limite_pago: limite };
        });
        validacion.limpiar('inicio');
        validacion.limpiar('fecha_limite_pago');
    };

    const cambiarDocumento = (evento) => {
        poner('documento', evento.target.value);
        validacionAlta.limpiar('documento');
        if (!contrasena) {
            setInquilino(null);
            setBusqueda('inicial');
        }
        setErrorInquilino(null);
    };

    const buscar = async () => {
        // Un documento que no es cédula no se consulta.
        if (errorDeDocumento(form.documento)) {
            validacion.revisar('documento', form);
            return;
        }
        setBusqueda('buscando');
        setErrorInquilino(null);
        try {
            const persona = await buscarPorDocumento(form.documento.trim());
            if (persona) {
                setInquilino({ id: persona.id, nombre: nombreDe(persona) });
                validacion.limpiar('documento');
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
        setErrorInquilino(null);
        if (!validacionAlta.alEnviar(alta)) return;
        setBusqueda('registrando');
        try {
            const respuesta = await crearInquilino({ ...alta, documento: form.documento });
            const nombre = nombreDe(respuesta.usuario);
            setInquilino({ id: respuesta.usuario.id, nombre });
            validacion.limpiar('documento');
            setContrasena({ contrasena: respuesta.contrasena_temporal, persona: nombre });
            onContrasena({ contrasena: respuesta.contrasena_temporal, persona: nombre });
            setBusqueda('inicial');
        } catch (fallo) {
            setErrorInquilino(validacionAlta.delServidor(fallo));
            setBusqueda('no-existe');
        }
    };

    const enviar = async (evento) => {
        evento.preventDefault();
        setError(null);
        if (!validacion.alEnviar(form)) return;
        // `documento` no viaja: la capa de datos recorta a `CAMPOS_CONTRATO`.
        const fallo = await onEnviar({ ...form, id_inquilino: inquilino.id });
        if (fallo) setError(validacion.delServidor(fallo));
    };

    const campoAlta = (nombre) => ({
        name: nombre, value: alta[nombre], error: validacionAlta.errores[nombre],
        onChange: (evento) => {
            setAlta((actual) => ({ ...actual, [nombre]: evento.target.value }));
            validacionAlta.limpiar(nombre);
        },
        onBlur: () => validacionAlta.alSalir(nombre, alta)
    });

    const errorDocumento = validacion.errores.documento ?? validacionAlta.errores.documento;

    const opcionesInmueble = inmuebles.map((i) => ({
        valor: i.id_inmueble, texto: [nombreDeInmueble(i), ubicacionDe(i)].filter(Boolean).join(' · ')
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
                    {errorDocumento && <p role="alert" className="m-0 mt-1 text-xs text-rojo-texto">{errorDocumento}</p>}
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
                            <Input etiqueta="Celular (opcional)" type="tel" {...campoAlta('telefono')} />
                        </Fila>
                        <div>
                            <Button variante="secundario" icono={UserPlus} onClick={registrar}
                                disabled={validacionAlta.hayErrores} cargando={busqueda === 'registrando'}>Registrar inquilino</Button>
                        </div>
                    </div>
                )}

                {contrasena && <ContrasenaTemporal {...contrasena} />}
            </Seccion>

            <Seccion titulo="Condiciones">
                <Fila>
                    <DateField etiqueta="Inicio" name="inicio" value={form.inicio} error={validacion.errores.inicio}
                        onChange={cambiarInicio} onBlur={alSalir('inicio')} />
                    <DateField etiqueta="Fin" name="fin" value={form.fin} error={validacion.errores.fin}
                        onChange={(valor) => poner('fin', valor)} onBlur={alSalir('fin')} />
                </Fila>
                <Fila>
                    <MoneyField etiqueta="Canon mensual" value={form.canon} error={validacion.errores.canon}
                        onChange={(valor) => poner('canon', valor)} onBlur={alSalir('canon')} />
                    <Input etiqueta="Día límite de pago" inputMode="numeric" placeholder="1 a 31"
                        ayuda="Día del mes. Se sugiere el del inicio." {...campo('fecha_limite_pago')} />
                </Fila>
                <DateField etiqueta="Primer corte (opcional)" name="fecha_inicio_corte" value={form.fecha_inicio_corte}
                    ayuda="Si lo dejas vacío, el ciclo de cobro empieza el día de inicio."
                    error={validacion.errores.fecha_inicio_corte}
                    onChange={(valor) => poner('fecha_inicio_corte', valor)} onBlur={alSalir('fecha_inicio_corte')} />
                <AreaTexto etiqueta="Condiciones particulares (opcional)" {...campo('info_contrato')} />
            </Seccion>

            <Seccion titulo="Deudor solidario (opcional)">
                <Fila>
                    <Input etiqueta="Nombre" {...campo('nombre_deudor_solidario')} />
                    <Input etiqueta="Documento" inputMode="numeric" ayuda="Cédula, sólo números." {...campo('documento_deudor_solidario')} />
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
    // Errores a la vista en el formulario de alta: deshabilitan «Firmar contrato».
    const [conErrores, setConErrores] = useState(false);
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
     * Disponibles para firmar: se descartan también los que tienen un contrato
     * activo en la lista, porque el estado del inmueble tarda unos segundos en cambiar.
     */
    const disponibles = useMemo(() => {
        const ocupados = new Set(contratos.filter((c) => c.estado === 'activo').map((c) => c.id_inmueble));
        return (inmuebles || []).filter((i) => i.estado === 'disponible' && !ocupados.has(i.id_inmueble));
    }, [inmuebles, contratos]);

    const algunoPropio = contratos.some((c) => actuaComoPropietario(c, sesion));

    const abrir = (nuevo) => { setErrorDialogo(null); setDialogo(nuevo); };
    const cerrar = () => { if (!enviando) setDialogo(null); };
    const abrirAlta = () => { setContrasenaNueva(null); abrir({ modo: 'crear' }); };

    /** Devuelve el error de la API, o `null`: el formulario lo pinta bajo su campo. */
    const crear = async (datos) => {
        setEnviando(true);
        try {
            await crearContrato(datos);
            setAviso('Contrato firmado. El inmueble pasará a «Arrendado» en unos segundos.');
            setDialogo(contrasenaNueva ? { modo: 'contrasena', ...contrasenaNueva } : null);
            setContrasenaNueva(null);
            await cargar();
            return null;
        } catch (error) {
            return error;
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
                        {nombreDeInmueble(c.Inmueble) || 'Inmueble sin datos'}
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
        { clave: 'estado', titulo: 'Estado', render: (c) => <Badge estado={c.situacion ?? c.estado} /> },
        {
            clave: 'acciones', titulo: 'Acciones', alinear: 'derecha',
            render: (c) => (
                <div className="flex justify-end gap-1">
                    <Link to={`/contratos/${c.id_contrato}`}
                        className="inline-flex items-center h-8 px-3 text-xs font-medium text-indigo-medio no-underline rounded-control hover:bg-lavanda">
                        Ver
                    </Link>
                    {actuaComoPropietario(c, sesion) && c.situacion === 'vencido_con_preaviso' && (
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
                        <Button type="submit" form={ID_FORMULARIO} cargando={enviando} disabled={conErrores}>Firmar contrato</Button>
                    </>
                }
            >
                {dialogo?.modo === 'crear' && (
                    <div className="flex flex-col gap-4">
                        {inmuebles === null && <FormError error="No se pudieron cargar tus inmuebles. Cierra e inténtalo de nuevo." />}
                        <FormularioContrato
                            idFormulario={ID_FORMULARIO}
                            inmuebles={disponibles}
                            onEnviar={crear}
                            onContrasena={setContrasenaNueva}
                            onErrores={setConErrores}
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
                {dialogo?.modo === 'finalizar' && (
                    <div className="flex flex-col gap-3">
                        <FormError error={errorDialogo} />
                        <p className="m-0 text-sm text-texto">
                            ¿Seguro que quieres finalizar el contrato de <span className="font-medium">{nombreDeInmueble(dialogo.contrato.Inmueble) || 'este inmueble'}</span>?
                            No se puede deshacer. El inmueble quedará disponible.
                        </p>
                        <AlertaMora idContrato={dialogo.contrato.id_contrato} />
                    </div>
                )}
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
