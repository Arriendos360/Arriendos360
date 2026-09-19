import { useCallback, useEffect, useMemo, useState } from 'react';
import { Home, Pencil, Plus, Trash2 } from 'lucide-react';
import { TIPOS_INMUEBLE } from 'arriendos360-contracts';

import { colombiaData } from '../data/colombia';
import { listarContratos } from '../features/contratos/api';
import { actualizarInmueble, crearInmueble, eliminarInmueble, listarInmuebles } from '../features/inmuebles/api';
import { listarCuentasCobro } from '../features/pagos/api';
import { Badge, Button, EmptyState, FormError, Input, Modal, Select, formatearDinero } from '../ui';

/**
 * UI de Inmuebles (mockup docs/mockups/inmuebles.png): KPIs, lista y el alta,
 * edición y borrado.
 *
 * Los campos son los del endpoint de ms-inmuebles, no los del Capítulo 2 (ver
 * `features/inmuebles/api.js`). El canon y el estado del cobro sólo
 * DECORAN la fila: si Contratos o Financiero no responden, la fila sale sin
 * ellos y la lista sigue en pie. Los inmuebles sí son el contenido: si fallan,
 * se dice.
 */

/** El catálogo va en minúsculas porque es un dato; la mayúscula es presentación. */
const etiquetaDeTipo = (tipo) => (tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : '');

const OPCIONES_TIPO = TIPOS_INMUEBLE.map((tipo) => ({ valor: tipo, texto: etiquetaDeTipo(tipo) }));
const DEPARTAMENTOS = Object.keys(colombiaData);

const FORM_VACIO = {
    direccion: '', tipo: 'apartamento', departamento: '', municipio: '', barrio: '',
    area_m2: '', habitaciones: '', banos: '', parqueaderos: '', deposito: '', estrato: ''
};

const aTexto = (valor) => (valor === null || valor === undefined ? '' : String(valor));

const formDeInmueble = (inmueble) =>
    Object.fromEntries(Object.keys(FORM_VACIO).map((campo) => [campo, aTexto(inmueble[campo])]));

/**
 * Errores por campo, o `{}` si el formulario se puede enviar. El servicio sólo
 * valida `direccion` y `tipo`; un entero mal escrito le llegaría como 500, así
 * que la forma se revisa aquí.
 */
function validar(form) {
    const errores = {};
    if (!form.direccion.trim()) errores.direccion = 'La dirección es obligatoria.';
    if (!TIPOS_INMUEBLE.includes(form.tipo)) errores.tipo = 'Elige un tipo.';
    if (form.area_m2.trim() && !/^\d{1,8}([.,]\d{1,2})?$/.test(form.area_m2.trim())) {
        errores.area_m2 = 'Escribe el área en m², con hasta dos decimales.';
    }
    for (const campo of ['habitaciones', 'banos', 'parqueaderos', 'deposito']) {
        if (form[campo].trim() && !/^\d{1,3}$/.test(form[campo].trim())) errores[campo] = 'Un número entero.';
    }
    if (form.estrato.trim() && !/^[1-6]$/.test(form.estrato.trim())) errores.estrato = 'De 1 a 6.';
    return errores;
}

/** La coma decimal se escribe en Colombia; NUMERIC la espera con punto. */
const paraEnviar = (form) => ({ ...form, area_m2: form.area_m2.trim().replace(',', '.') });

/**
 * La cuenta que resume el cobro de cada contrato: la más antigua en mora si hay
 * alguna, y si no la más reciente. Mirar sólo la última escondería una mora de
 * agosto detrás del «Pendiente» de septiembre. `inicio` es YYYY-MM-DD y ordena
 * como texto.
 */
function cuentaQueResumePorContrato(cuentas) {
    const porContrato = new Map();
    for (const cuenta of cuentas) {
        const actual = porContrato.get(cuenta.id_contrato);
        const enMora = cuenta.estado === 'EN_MORA';
        const actualEnMora = actual?.estado === 'EN_MORA';
        const gana =
            !actual ||
            (enMora && !actualEnMora) ||
            (enMora && actualEnMora && String(cuenta.inicio) < String(actual.inicio)) ||
            (!enMora && !actualEnMora && String(cuenta.inicio) > String(actual.inicio));
        if (gana) porContrato.set(cuenta.id_contrato, cuenta);
    }
    return porContrato;
}

function Kpi({ etiqueta, valor }) {
    return (
        <div className="box-border flex-1 min-w-[10rem] bg-superficie border border-solid border-borde rounded-tarjeta px-5 py-4">
            <p className="m-0 text-xs font-medium uppercase tracking-label text-texto-label">{etiqueta}</p>
            <p className="m-0 mt-2 text-2xl font-medium text-indigo-medio tabular-nums">{valor}</p>
        </div>
    );
}

function FilaInmueble({ inmueble, contrato, cuenta, onEditar, onEliminar }) {
    const ubicacion = [inmueble.barrio, inmueble.municipio].filter(Boolean).join(', ');
    const subtitulo = [ubicacion, etiquetaDeTipo(inmueble.tipo)].filter(Boolean).join(' · ');

    return (
        <li className="box-border flex flex-wrap items-center gap-4 bg-superficie border border-solid border-borde rounded-tarjeta px-4 py-3">
            <span className="flex items-center justify-center shrink-0 w-10 h-10 rounded-control bg-chip text-indigo-medio">
                <Home size={18} aria-hidden="true" />
            </span>
            <div className="flex-1 min-w-[12rem]">
                <p className="m-0 text-sm font-medium text-texto break-words">{inmueble.direccion}</p>
                {subtitulo && <p className="m-0 mt-0.5 text-xs text-texto-suave">{subtitulo}</p>}
            </div>
            {contrato && (
                <div className="text-right">
                    <p className="m-0 text-xs font-medium uppercase tracking-label text-texto-label">Canon/mes</p>
                    <p className="m-0 mt-0.5 text-sm font-medium text-texto tabular-nums">{formatearDinero(contrato.canon)}</p>
                </div>
            )}
            {/* Con contrato, cómo va el cobro (ver cuentaQueResumePorContrato); sin cobros aún, o sin
                datos de Financiero, el estado del inmueble. */}
            <Badge estado={cuenta ? cuenta.estado : inmueble.estado} />
            <div className="flex items-center gap-1">
                <Button variante="fantasma" tamano="pequeno" icono={Pencil} onClick={() => onEditar(inmueble)}
                    aria-label={`Editar ${inmueble.direccion}`} title="Editar" />
                <Button variante="fantasma" tamano="pequeno" icono={Trash2} onClick={() => onEliminar(inmueble)}
                    aria-label={`Eliminar ${inmueble.direccion}`} title="Eliminar" />
            </div>
        </li>
    );
}

/** Dos o tres campos en fila en pantallas anchas, apilados en las angostas. */
const Fila = ({ children }) => <div className="flex flex-col sm:flex-row gap-4 [&>*]:flex-1">{children}</div>;

/** El botón de envío vive en el pie del modal, fuera del <form>: `form={idFormulario}` lo enlaza. */
function FormularioInmueble({ inicial, error, onEnviar, idFormulario }) {
    const [form, setForm] = useState(inicial);
    const [errores, setErrores] = useState({});

    const cambiar = (evento) => {
        const { name, value } = evento.target;
        setForm((actual) => (name === 'departamento' ? { ...actual, departamento: value, municipio: '' } : { ...actual, [name]: value }));
        setErrores((actuales) => ({ ...actuales, [name]: undefined }));
    };

    const enviar = (evento) => {
        evento.preventDefault();
        const encontrados = validar(form);
        setErrores(encontrados);
        if (Object.keys(encontrados).length === 0) onEnviar(paraEnviar(form));
    };

    const municipios = colombiaData[form.departamento] || [];
    // Un municipio guardado que no está en la lista (datos viejos) se sigue ofreciendo.
    const opcionesMunicipio = form.municipio && !municipios.includes(form.municipio) ? [form.municipio, ...municipios] : municipios;
    const campo = (nombre) => ({ name: nombre, value: form[nombre], onChange: cambiar, error: errores[nombre] });

    return (
        <form id={idFormulario} onSubmit={enviar} noValidate className="flex flex-col gap-4">
            <FormError error={error} />
            <Input etiqueta="Dirección" placeholder="Calle 100 # 15-20" required autoFocus {...campo('direccion')} />
            <Fila>
                <Select etiqueta="Tipo" opciones={OPCIONES_TIPO} {...campo('tipo')} />
                <Input etiqueta="Barrio" placeholder="Chicó" {...campo('barrio')} />
            </Fila>
            <Fila>
                <Select etiqueta="Departamento" vacio="Selecciona…" opciones={DEPARTAMENTOS} {...campo('departamento')} />
                <Select etiqueta="Municipio" vacio="Selecciona…" opciones={opcionesMunicipio}
                    disabled={!form.departamento && !form.municipio} {...campo('municipio')} />
            </Fila>
            <Fila>
                <Input etiqueta="Área (m²)" inputMode="decimal" placeholder="78" {...campo('area_m2')} />
                <Input etiqueta="Estrato" inputMode="numeric" placeholder="1 a 6" {...campo('estrato')} />
            </Fila>
            <Fila>
                <Input etiqueta="Habitaciones" inputMode="numeric" {...campo('habitaciones')} />
                <Input etiqueta="Baños" inputMode="numeric" {...campo('banos')} />
            </Fila>
            <Fila>
                <Input etiqueta="Parqueaderos" inputMode="numeric" {...campo('parqueaderos')} />
                <Input etiqueta="Depósitos" inputMode="numeric" {...campo('deposito')} />
            </Fila>
        </form>
    );
}

const ID_FORMULARIO = 'formulario-inmueble';

export default function Inmuebles() {
    const [inmuebles, setInmuebles] = useState([]);
    // `null` = no se pudo decorar; la fila sale sin canon ni cobro.
    const [contratos, setContratos] = useState(null);
    const [cuentas, setCuentas] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState(null);
    const [aviso, setAviso] = useState('');

    // { modo: 'crear' } | { modo: 'editar', inmueble } | { modo: 'eliminar', inmueble } | null
    const [dialogo, setDialogo] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [errorDialogo, setErrorDialogo] = useState(null);

    const cargar = useCallback(async () => {
        setErrorCarga(null);
        const [inm, con, cue] = await Promise.allSettled([listarInmuebles(), listarContratos(), listarCuentasCobro()]);
        if (inm.status === 'fulfilled') setInmuebles(inm.value);
        else setErrorCarga(inm.reason);
        setContratos(con.status === 'fulfilled' ? con.value : null);
        setCuentas(cue.status === 'fulfilled' ? cue.value : null);
        setCargando(false);
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const contratoActivoPorInmueble = useMemo(
        () => new Map((contratos || []).filter((c) => c.estado === 'activo').map((c) => [c.id_inmueble, c])),
        [contratos]
    );
    const cuentaPorContrato = useMemo(() => cuentaQueResumePorContrato(cuentas || []), [cuentas]);

    const abrir = (nuevo) => { setErrorDialogo(null); setDialogo(nuevo); };
    const cerrar = () => { if (!enviando) setDialogo(null); };

    const terminar = async (mensaje) => {
        setDialogo(null);
        setAviso(mensaje);
        await cargar();
    };

    const guardar = async (datos) => {
        setEnviando(true);
        setErrorDialogo(null);
        try {
            if (dialogo.modo === 'editar') {
                await actualizarInmueble(dialogo.inmueble.id_inmueble, datos);
                await terminar('Inmueble actualizado.');
            } else {
                await crearInmueble(datos);
                await terminar('Inmueble registrado.');
            }
        } catch (error) {
            setErrorDialogo(error);
        } finally {
            setEnviando(false);
        }
    };

    /** Con un contrato activo el gateway responde 409 y su `mensaje` dice qué hacer: se muestra tal cual. */
    const eliminar = async () => {
        setEnviando(true);
        setErrorDialogo(null);
        try {
            await eliminarInmueble(dialogo.inmueble.id_inmueble);
            await terminar('Inmueble eliminado.');
        } catch (error) {
            setErrorDialogo(error);
        } finally {
            setEnviando(false);
        }
    };

    const arrendados = inmuebles.filter((i) => i.estado === 'arrendado').length;
    const disponibles = inmuebles.filter((i) => i.estado === 'disponible').length;
    const formularioAbierto = dialogo?.modo === 'crear' || dialogo?.modo === 'editar';

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="m-0 text-2xl font-medium text-texto">Mis inmuebles</h1>
                    <p className="m-0 mt-1 text-sm text-texto-suave">Gestiona tus propiedades y sus contratos de arrendamiento.</p>
                </div>
                <Button icono={Plus} onClick={() => abrir({ modo: 'crear' })}>Registrar propiedad</Button>
            </header>

            <p aria-live="polite" className="m-0 text-sm text-texto-suave empty:hidden">{aviso}</p>

            {cargando ? (
                <p className="m-0 text-sm text-texto-suave">Cargando inmuebles…</p>
            ) : errorCarga ? (
                <div className="flex flex-col items-start gap-3">
                    <FormError error={errorCarga} className="w-full box-border" />
                    <Button variante="secundario" onClick={() => { setCargando(true); cargar(); }}>Reintentar</Button>
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap gap-4">
                        <Kpi etiqueta="Total propiedades" valor={inmuebles.length} />
                        <Kpi etiqueta="Arrendadas" valor={arrendados} />
                        <Kpi etiqueta="Disponibles" valor={disponibles} />
                    </div>

                    {inmuebles.length === 0 ? (
                        <div className="bg-superficie border border-solid border-borde rounded-tarjeta">
                            <EmptyState
                                icono={Home}
                                titulo="Aún no tienes inmuebles"
                                descripcion="Registra tu primera propiedad para poder arrendarla."
                                accion={<Button icono={Plus} onClick={() => abrir({ modo: 'crear' })}>Registrar propiedad</Button>}
                            />
                        </div>
                    ) : (
                        <ul className="flex flex-col gap-3 list-none m-0 p-0">
                            {inmuebles.map((inmueble) => {
                                const contrato = contratoActivoPorInmueble.get(inmueble.id_inmueble);
                                return (
                                    <FilaInmueble
                                        key={inmueble.id_inmueble}
                                        inmueble={inmueble}
                                        contrato={contrato}
                                        cuenta={contrato ? cuentaPorContrato.get(contrato.id_contrato) : undefined}
                                        onEditar={(i) => abrir({ modo: 'editar', inmueble: i })}
                                        onEliminar={(i) => abrir({ modo: 'eliminar', inmueble: i })}
                                    />
                                );
                            })}
                        </ul>
                    )}
                </>
            )}

            <Modal
                abierto={formularioAbierto}
                onCerrar={cerrar}
                titulo={dialogo?.modo === 'editar' ? 'Editar propiedad' : 'Registrar propiedad'}
                ancho="max-w-2xl"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button type="submit" form={ID_FORMULARIO} cargando={enviando}>
                            {dialogo?.modo === 'editar' ? 'Guardar cambios' : 'Registrar'}
                        </Button>
                    </>
                }
            >
                {formularioAbierto && (
                    <FormularioInmueble
                        key={dialogo.inmueble?.id_inmueble || 'nuevo'}
                        idFormulario={ID_FORMULARIO}
                        inicial={dialogo.inmueble ? formDeInmueble(dialogo.inmueble) : FORM_VACIO}
                        error={errorDialogo}
                        onEnviar={guardar}
                    />
                )}
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'eliminar'}
                onCerrar={cerrar}
                titulo="Eliminar propiedad"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button onClick={eliminar} cargando={enviando} icono={Trash2}>Eliminar</Button>
                    </>
                }
            >
                <div className="flex flex-col gap-3">
                    <FormError error={errorDialogo} />
                    <p className="m-0 text-sm text-texto">
                        ¿Eliminar <span className="font-medium">{dialogo?.inmueble?.direccion}</span>? Esta acción no se puede deshacer.
                    </p>
                </div>
            </Modal>
        </div>
    );
}
