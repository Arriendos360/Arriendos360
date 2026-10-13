import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileText, Plus, Receipt } from 'lucide-react';

import { useSesion } from '../auth/sesion';
import { listarContratos } from '../features/contratos/api';
import { AreaTexto, actuaComoPropietario, nombreDe, nombreDeInmueble, ubicacionDe } from '../features/contratos/piezas';
import {
    MEDIOS_PAGO_CONOCIDOS, abrirComprobante, abrirRecibo, anularTransaccion, crearCuentaCobro,
    listarCuentasCobro, listarMovimientos, registrarPago, transaccionesDeCuenta
} from '../features/pagos/api';
import {
    FILTROS, cumple, desglosar, filtrarCuentas, filtrarMovimientos, totalMovimientos, totales
} from '../features/pagos/desglose';
import { validarFormularioCobro, validarFormularioPago } from '../features/pagos/reglas';
import {
    Badge, Button, DateField, EmptyState, FormError, Input, Modal, MoneyField, Select, Table,
    aDecimal, formatearDinero, formatearFecha, formatearFechaHora, formatearMes, hoyEnBogota
} from '../ui';
import { unir } from '../ui/clases';
import { useValidacion } from '../ui/validacion';

/**
 * Pagos: las cuentas de cobro, sus
 * transacciones y sus PDF.
 *
 * - El saldo es `saldo_pendiente` tal como llega: lo deriva ms-financiero y aquí
 *   no se suma ni se resta nada. Después de escribir se vuelve a pedir.
 * - Registrar, cobrar a mano y anular son del propietario, y no
 *   basta el rol: quien tiene los dos es inquilino en algunos contratos
 *   (`actuaComoPropietario`). Una cuenta cuyo contrato no llegó decorado no
 *   ofrece acciones: sin contrato no se sabe de quién es.
 * - Anular no borra ni cambia `saldo_restante_momento`, y no pide motivo: el
 *   endpoint no recibe cuerpo.
 * - Los PDF salen por blob con el token (services/descargas.js).
 */

/** ¿Queda algo por pagar? Se lee del texto decimal, sin operar. */
const tieneSaldo = (cuenta) => {
    const saldo = aDecimal(cuenta.saldo_pendiente);
    return saldo !== null && saldo !== '0' && !saldo.startsWith('-');
};

const esPropia = (cuenta, sesion) => actuaComoPropietario(cuenta.Contrato, sesion);

/** Un cobro sin periodo (la indemnización de un contrato terminado) no tiene mes ni rango. */
const mesDe = (cuenta) => (cuenta.inicio ? formatearMes(cuenta.inicio) : 'Sin periodo');
const rangoDe = (cuenta) => (cuenta.inicio ? `${formatearFecha(cuenta.inicio)} – ${formatearFecha(cuenta.fin)}` : null);

const Fila = ({ children }) => <div className="flex flex-col sm:flex-row gap-4 [&>*]:flex-1">{children}</div>;

/** Una cifra del resumen de la cuenta en el detalle. */
const Dato = ({ titulo, children }) => (
    <div className="flex flex-col gap-1 min-w-[8rem]">
        <span className="text-xs font-medium uppercase tracking-label text-texto-label">{titulo}</span>
        <span className="text-sm text-texto">{children}</span>
    </div>
);

/** Una pestaña de la fila de pestañas. */
const Pestana = ({ activa, tono = 'text-texto-suave', onClick, children }) => (
    <button type="button" role="tab" aria-selected={activa} onClick={onClick}
        className={unir(
            'h-8 px-3 m-0 text-xs font-medium font-sans rounded-control border border-solid cursor-pointer',
            activa ? 'bg-indigo-medio border-indigo-medio text-white' : unir('bg-superficie border-borde', tono)
        )}>
        {children}
    </button>
);

/** Los cuatro totales de lo que el filtro deja ver. */
const Totales = ({ valores }) => (
    <div className="flex flex-wrap gap-x-8 gap-y-4 bg-superficie border border-solid border-borde rounded-tarjeta p-5">
        <Dato titulo="Facturado"><span className="tabular-nums">{formatearDinero(valores.facturado)}</span></Dato>
        <Dato titulo="Recaudado"><span className="tabular-nums text-verde-texto">{formatearDinero(valores.recaudado)}</span></Dato>
        <Dato titulo="Pendiente"><span className="tabular-nums">{formatearDinero(valores.pendiente)}</span></Dato>
        <Dato titulo="En mora"><span className="tabular-nums text-rojo-texto">{formatearDinero(valores.en_mora)}</span></Dato>
    </div>
);

function Saldo({ cuenta }) {
    const saldo = aDecimal(cuenta.saldo_pendiente);
    if (saldo === null) return <span className="text-texto-suave">—</span>;
    return (
        <span className={unir('font-medium whitespace-nowrap', tieneSaldo(cuenta) ? 'text-rojo-texto' : 'text-verde-texto')}>
            {formatearDinero(saldo)}
        </span>
    );
}

function Inmueble({ cuenta }) {
    const inmueble = cuenta.Contrato?.Inmueble;
    return (
        <div className="min-w-[10rem]">
            <p className="m-0 text-sm font-medium text-texto">{nombreDeInmueble(inmueble) || 'Inmueble sin datos'}</p>
            {ubicacionDe(inmueble) && <p className="m-0 mt-0.5 text-xs text-texto-suave">{ubicacionDe(inmueble)}</p>}
        </div>
    );
}

// ── Formularios ───────────────────────────────────────────────────────────

const ID_PAGO = 'formulario-pago';
const ID_COBRO = 'formulario-cobro';

/**
 * `POST /api/pagos`. El monto se propone con el saldo (se copia, no se calcula) y
 * el tope lo hace cumplir el servicio. `medio_pago` es un catálogo abierto; `tipo`
 * lo pone la capa de datos. `onEnviar` devuelve el error de la API, o `null`.
 */
function FormularioPago({ cuenta, onEnviar, onErrores }) {
    const hoy = hoyEnBogota();
    const [form, setForm] = useState({
        monto: aDecimal(cuenta.saldo_pendiente), medio_pago: MEDIOS_PAGO_CONOCIDOS[0], fecha_pago: hoy, observaciones: ''
    });
    const [error, setError] = useState(null);
    const validacion = useValidacion((datos) => validarFormularioPago(datos, hoy), ['monto', 'fecha_pago', 'medio_pago']);

    useEffect(() => { onErrores(validacion.hayErrores); }, [validacion.hayErrores, onErrores]);

    const poner = (nombre, valor) => {
        setForm((actual) => ({ ...actual, [nombre]: valor }));
        validacion.limpiar(nombre);
    };
    const alSalir = (nombre) => () => validacion.alSalir(nombre, form);

    const enviar = async (evento) => {
        evento.preventDefault();
        setError(null);
        if (!validacion.alEnviar(form)) return;
        // Hoy no viaja: el servicio registra el momento exacto.
        const fallo = await onEnviar({
            ...form,
            id_cuenta_cobro: cuenta.id_cuenta_cobro,
            fecha_pago: form.fecha_pago === hoy ? undefined : form.fecha_pago
        });
        if (fallo) setError(validacion.delServidor(fallo));
    };

    return (
        <form id={ID_PAGO} onSubmit={enviar} noValidate className="flex flex-col gap-4">
            <FormError error={error} />
            <div className="flex flex-wrap gap-6 bg-lavanda rounded-control p-4">
                <Dato titulo="Periodo">{mesDe(cuenta)}</Dato>
                <Dato titulo="Valor">{formatearDinero(cuenta.valor)}</Dato>
                <Dato titulo="Saldo pendiente"><Saldo cuenta={cuenta} /></Dato>
            </div>
            <Fila>
                <MoneyField etiqueta="Monto recibido" value={form.monto} error={validacion.errores.monto}
                    ayuda="Puede ser un abono: el resto queda pendiente." onChange={(valor) => poner('monto', valor)}
                    onBlur={alSalir('monto')} />
                <DateField etiqueta="Fecha del pago" name="fecha_pago" value={form.fecha_pago} max={hoy}
                    error={validacion.errores.fecha_pago} onChange={(valor) => poner('fecha_pago', valor)}
                    onBlur={alSalir('fecha_pago')} />
            </Fila>
            <Select etiqueta="Medio de pago" opciones={MEDIOS_PAGO_CONOCIDOS} value={form.medio_pago}
                error={validacion.errores.medio_pago} onChange={(evento) => poner('medio_pago', evento.target.value)} />
            <AreaTexto etiqueta="Referencia (opcional)" name="observaciones" value={form.observaciones}
                ayuda="Número de transferencia o consignación. Sale en el comprobante."
                onChange={(evento) => poner('observaciones', evento.target.value)} />
        </form>
    );
}

/**
 * `POST /api/pagos/cuentas-cobro`. Sin `inicio` el servicio cobra el periodo en
 * curso; el `fin` lo calcula siempre él con el día de corte del contrato.
 * `onEnviar` devuelve el error de la API, o `null`.
 */
function FormularioCobro({ contratos, onEnviar, onErrores }) {
    const [form, setForm] = useState({ id_contrato: '', valor: null, detalle: '', inicio: '' });
    const [error, setError] = useState(null);
    const validacion = useValidacion(validarFormularioCobro, ['id_contrato', 'valor']);

    useEffect(() => { onErrores(validacion.hayErrores); }, [validacion.hayErrores, onErrores]);

    const poner = (nombre, valor) => {
        setForm((actual) => ({ ...actual, [nombre]: valor }));
        validacion.limpiar(nombre);
    };

    /** El valor se propone con el canon del contrato elegido. */
    const elegirContrato = (evento) => {
        const id = evento.target.value;
        const contrato = contratos.find((c) => c.id_contrato === id);
        setForm((actual) => ({ ...actual, id_contrato: id, valor: contrato ? aDecimal(contrato.canon) : actual.valor }));
        validacion.limpiar('id_contrato');
        validacion.limpiar('valor');
    };

    const enviar = async (evento) => {
        evento.preventDefault();
        setError(null);
        if (!validacion.alEnviar(form)) return;
        const fallo = await onEnviar(form);
        if (fallo) setError(validacion.delServidor(fallo));
    };

    const opciones = contratos.map((c) => ({
        valor: c.id_contrato, texto: [nombreDeInmueble(c.Inmueble) || 'Inmueble sin datos', ubicacionDe(c.Inmueble)].filter(Boolean).join(' · ')
    }));

    return (
        <form id={ID_COBRO} onSubmit={enviar} noValidate className="flex flex-col gap-4">
            <FormError error={error} />
            <Select etiqueta="Contrato" vacio={contratos.length ? 'Selecciona…' : 'No tienes contratos activos'}
                opciones={opciones} disabled={!contratos.length} value={form.id_contrato}
                error={validacion.errores.id_contrato} onChange={elegirContrato}
                onBlur={() => validacion.alSalir('id_contrato', form)} />
            <Fila>
                <MoneyField etiqueta="Valor" value={form.valor} error={validacion.errores.valor}
                    onChange={(valor) => poner('valor', valor)} onBlur={() => validacion.alSalir('valor', form)} />
                <DateField etiqueta="Inicio del periodo (opcional)" name="inicio" value={form.inicio}
                    ayuda="Se ajusta al día de corte del contrato. Vacío: el periodo en curso." onChange={(valor) => poner('inicio', valor)} />
            </Fila>
            <Input etiqueta="Concepto (opcional)" name="detalle" value={form.detalle}
                placeholder="Canon de arrendamiento del periodo"
                onChange={(evento) => poner('detalle', evento.target.value)} />
            <p className="m-0 text-xs text-texto-suave">El inquilino recibirá un aviso por correo con el cobro.</p>
        </form>
    );
}

// ── Pantalla ──────────────────────────────────────────────────────────────

export default function Pagos() {
    const sesion = useSesion();
    const { esPropietario } = sesion;

    const [cuentas, setCuentas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState(null);
    // Todos los contratos, para los filtros y sus rótulos. Si no llegan, los filtros quedan sin opciones.
    const [contratos, setContratos] = useState([]);
    // `null` hasta que se abre «Movimientos» por primera vez, y otra vez tras registrar o anular.
    const [movimientos, setMovimientos] = useState(null);
    const [errorMovimientos, setErrorMovimientos] = useState(null);
    // { texto, idComprobante? }
    const [aviso, setAviso] = useState(null);
    const [errorDescarga, setErrorDescarga] = useState(null);

    // { modo: 'pagar' | 'detalle', cuenta } | { modo: 'anular', cuenta, transaccion } | { modo: 'cobro' } | null
    const [dialogo, setDialogo] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [errorDialogo, setErrorDialogo] = useState(null);
    // Errores a la vista en el formulario de pago o de cobro: deshabilitan su botón.
    const [conErrores, setConErrores] = useState(false);
    // Las del detalle abierto: `null` mientras cargan.
    const [transacciones, setTransacciones] = useState(null);
    // Contratos activos propios, para el cobro manual. `null` = no se pudieron cargar.
    const [contratosPropios, setContratosPropios] = useState([]);

    const cargar = useCallback(async () => {
        setErrorCarga(null);
        try {
            const lista = await listarCuentasCobro();
            // El servicio no ordena `GET /api/pagos`: el periodo más reciente primero.
            setCuentas([...lista].sort((a, b) => String(b.inicio ?? b.fecha_creacion).localeCompare(String(a.inicio ?? a.fecha_creacion))));
        } catch (error) {
            setErrorCarga(error);
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { listarContratos().then(setContratos, () => setContratos([])); }, []);

    // Los filtros viven en la URL: sobreviven a ir a otra pantalla y volver con «atrás».
    const [params, setParams] = useSearchParams();
    const vista = params.get('vista') === 'movimientos' ? 'movimientos' : 'cobros';
    const quienDe = (contrato) => (actuaComoPropietario(contrato, sesion) ? nombreDe(contrato.Inquilino) || 'Inquilino sin datos' : 'Tú');
    const contratoPorId = new Map(contratos.map((c) => [c.id_contrato, c]));
    const opcionesInmueble = [...new Map(contratos.map((c) => [c.id_inmueble, nombreDeInmueble(c.Inmueble) || 'Inmueble sin datos']))]
        .map(([valor, texto]) => ({ valor, texto }));
    // Un parámetro que no es ninguna opción (un id viejo) se ignora.
    const elegido = (clave, opciones) => (opciones.some((o) => o.valor === params.get(clave)) ? params.get(clave) : '');
    const inmueble = elegido('inmueble', opcionesInmueble);
    const opcionesContrato = contratos
        .filter((c) => !inmueble || c.id_inmueble === inmueble)
        .map((c) => ({ valor: c.id_contrato, texto: `${nombreDeInmueble(c.Inmueble) || 'Inmueble sin datos'} · ${quienDe(c)}` }));
    const seleccion = { inmueble, contrato: elegido('contrato', opcionesContrato) };
    const estado = FILTROS.find((f) => f.clave === params.get('estado')) ?? FILTROS[0];
    const fechas = { desde: params.get('desde') ?? '', hasta: params.get('hasta') ?? '' };
    const filtrar = (cambios) => setParams((actuales) => {
        const nuevos = new URLSearchParams(actuales);
        for (const [clave, valor] of Object.entries(cambios)) {
            if (valor) nuevos.set(clave, valor); else nuevos.delete(clave);
        }
        return nuevos;
    }, { replace: true });
    const conFiltros = Boolean(seleccion.inmueble || seleccion.contrato || (vista === 'movimientos' && (fechas.desde || fechas.hasta)));

    const seleccionadas = filtrarCuentas(cuentas, seleccion);
    const visibles = filtrarCuentas(cuentas, { ...seleccion, estado: estado.clave });

    const cargarMovimientos = useCallback(async () => {
        setErrorMovimientos(null);
        try {
            setMovimientos(await listarMovimientos());
        } catch (error) {
            setErrorMovimientos(error);
        }
    }, []);

    useEffect(() => {
        if (vista === 'movimientos' && movimientos === null) cargarMovimientos();
    }, [vista, movimientos, cargarMovimientos]);

    const movimientosVisibles = movimientos ? filtrarMovimientos(movimientos, { ...seleccion, ...fechas }) : [];

    const abrir = (nuevo) => { setErrorDialogo(null); setDialogo(nuevo); };
    const cerrar = () => { if (!enviando) setDialogo(null); };

    const descargar = async (accion) => {
        setErrorDescarga(null);
        try {
            await accion();
        } catch (error) {
            setErrorDescarga(error);
        }
    };

    const cargarTransacciones = async (cuenta) => {
        setTransacciones(null);
        try {
            setTransacciones(await transaccionesDeCuenta(cuenta.id_cuenta_cobro));
        } catch (error) {
            setTransacciones([]);
            setErrorDialogo(error);
        }
    };

    const verDetalle = (cuenta) => {
        abrir({ modo: 'detalle', cuenta });
        cargarTransacciones(cuenta);
    };

    const abrirCobro = async () => {
        abrir({ modo: 'cobro' });
        try {
            const contratos = await listarContratos();
            setContratosPropios(contratos.filter((c) => c.estado === 'activo' && actuaComoPropietario(c, sesion)));
        } catch (error) {
            setContratosPropios(null);
        }
    };

    /** Envuelve una escritura: bloquea el diálogo y recarga la lista. Devuelve el error, o `null`. */
    const escribir = async (operacion) => {
        setEnviando(true);
        setErrorDialogo(null);
        try {
            await operacion();
            await cargar();
            return null;
        } catch (error) {
            setErrorDialogo(error);
            return error;
        } finally {
            setEnviando(false);
        }
    };

    const pagar = (datos) => escribir(async () => {
        const respuesta = await registrarPago(datos);
        setMovimientos(null);
        setDialogo(null);
        setAviso({ texto: respuesta.mensaje || 'Pago registrado.', idComprobante: respuesta.transaccion?.id_transaccion });
    });

    const cobrar = (datos) => escribir(async () => {
        await crearCuentaCobro(datos);
        setDialogo(null);
        setAviso({ texto: 'Cobro registrado. Se avisará al inquilino por correo.' });
    });

    /** Tras anular se vuelve al detalle con la cuenta que devuelve el servicio (su saldo, no uno calculado aquí). */
    const anular = () => escribir(async () => {
        const { cuenta, transaccion } = dialogo;
        const respuesta = await anularTransaccion(transaccion.id_transaccion);
        setMovimientos(null);
        const actualizada = { ...cuenta, ...respuesta.cuenta_cobro };
        setAviso({ texto: 'Transacción anulada. El saldo de la cuenta se recalculó.' });
        setDialogo({ modo: 'detalle', cuenta: actualizada });
        cargarTransacciones(actualizada);
    });


    const columnas = [
        {
            clave: 'mes', titulo: 'Mes',
            render: (c) => (
                <div className="whitespace-nowrap">
                    <p className="m-0 text-sm text-texto first-letter:uppercase">{mesDe(c)}</p>
                    <p className="m-0 mt-0.5 max-w-[16rem] truncate text-xs text-texto-suave" title={c.detalle}>{rangoDe(c) ?? c.detalle}</p>
                </div>
            )
        },
        { clave: 'inmueble', titulo: 'Inmueble', render: (c) => <Inmueble cuenta={c} /> },
        { clave: 'valor', titulo: 'Monto', alinear: 'derecha', render: (c) => formatearDinero(c.valor) },
        { clave: 'saldo', titulo: 'Saldo', alinear: 'derecha', render: (c) => <Saldo cuenta={c} /> },
        { clave: 'estado', titulo: 'Estado', render: (c) => <Badge estado={c.estado} /> },
        {
            clave: 'acciones', titulo: 'Acciones', alinear: 'derecha',
            render: (c) => (
                <div className="flex justify-end gap-1">
                    {esPropia(c, sesion) && tieneSaldo(c) && (
                        <Button tamano="pequeno" onClick={() => abrir({ modo: 'pagar', cuenta: c })}>Registrar</Button>
                    )}
                    <Button variante="fantasma" tamano="pequeno" onClick={() => verDetalle(c)}>
                        {tieneSaldo(c) ? 'Detalle' : 'Ver comprobantes'}
                    </Button>
                </div>
            )
        }
    ];

    const columnasTransacciones = (cuenta) => [
        { clave: 'fecha', titulo: 'Fecha', render: (t) => <span className="whitespace-nowrap">{formatearFechaHora(t.fecha_pago)}</span> },
        {
            clave: 'medio', titulo: 'Medio',
            render: (t) => (
                <div>
                    <p className="m-0">{t.medio_pago || '—'}</p>
                    {t.observaciones && <p className="m-0 mt-0.5 text-xs text-texto-suave break-all">{t.observaciones}</p>}
                </div>
            )
        },
        { clave: 'monto', titulo: 'Monto', alinear: 'derecha', render: (t) => <span className="whitespace-nowrap">{formatearDinero(t.monto)}</span> },
        {
            clave: 'saldo', titulo: 'Saldo impreso', alinear: 'derecha',
            render: (t) => <span className="whitespace-nowrap text-texto-suave">{formatearDinero(t.saldo_restante_momento)}</span>
        },
        { clave: 'estado', titulo: 'Estado', render: (t) => <Badge estado={t.estado} /> },
        {
            clave: 'acciones', titulo: '', alinear: 'derecha',
            render: (t) => (
                <div className="flex justify-end gap-1">
                    <Button variante="fantasma" tamano="pequeno" icono={Download}
                        onClick={() => descargar(() => abrirComprobante(t.id_transaccion))}>Comprobante</Button>
                    {esPropia(cuenta, sesion) && t.estado === 'CONFIRMADA' && (
                        <Button variante="fantasma" tamano="pequeno"
                            onClick={() => abrir({ modo: 'anular', cuenta, transaccion: t })}>Anular</Button>
                    )}
                </div>
            )
        }
    ];

    const columnasDesglose = [
        {
            clave: 'nombre', titulo: 'Inmueble / contrato',
            render: (fila) => (fila.nivel === 0
                ? <span className="font-medium">{fila.nombre}</span>
                : <span className="pl-5 text-texto-suave">{fila.nombre}</span>)
        },
        ...[['facturado', 'Facturado'], ['recaudado', 'Recaudado'], ['pendiente', 'Pendiente'], ['en_mora', 'En mora']]
            .map(([clave, titulo]) => ({
                clave, titulo, alinear: 'derecha',
                render: (fila) => <span className="tabular-nums whitespace-nowrap">{formatearDinero(fila.totales[clave])}</span>
            }))
    ];

    const filasDesglose = desglosar(visibles).flatMap((grupo, i) => [
        {
            clave: `inmueble-${i}`, nivel: 0, totales: grupo.totales,
            nombre: grupo.sinContrato ? 'Sin datos del contrato' : nombreDeInmueble(grupo.inmueble) || 'Inmueble sin datos'
        },
        ...(grupo.sinContrato ? [] : grupo.contratos.map((c) => ({
            clave: c.id_contrato, nivel: 1, totales: c.totales,
            nombre: contratoPorId.has(c.id_contrato) ? quienDe(contratoPorId.get(c.id_contrato)) : 'Contrato sin datos'
        })))
    ]);

    const columnasMovimientos = [
        { clave: 'fecha', titulo: 'Fecha', render: (t) => <span className="whitespace-nowrap">{formatearFechaHora(t.fecha_pago)}</span> },
        { clave: 'inmueble', titulo: 'Inmueble', render: (t) => <Inmueble cuenta={t.CuentaCobro ?? {}} /> },
        {
            clave: 'contrato', titulo: 'Contrato',
            render: (t) => (contratoPorId.has(t.CuentaCobro?.id_contrato) ? quienDe(contratoPorId.get(t.CuentaCobro.id_contrato)) : '—')
        },
        { clave: 'medio', titulo: 'Medio', render: (t) => t.medio_pago || '—' },
        { clave: 'monto', titulo: 'Monto', alinear: 'derecha', render: (t) => <span className="whitespace-nowrap tabular-nums">{formatearDinero(t.monto)}</span> },
        { clave: 'estado', titulo: 'Estado', render: (t) => <Badge estado={t.estado} /> },
        {
            clave: 'comprobante', titulo: '', alinear: 'derecha',
            render: (t) => (
                <Button variante="fantasma" tamano="pequeno" icono={Download}
                    onClick={() => descargar(() => abrirComprobante(t.id_transaccion))}>Comprobante</Button>
            )
        }
    ];

    const titulo = esPropietario ? 'Gestión financiera' : 'Mis pagos';
    const subtitulo = esPropietario
        ? 'Control de cobros, pagos y comprobantes de transacciones.'
        : 'Consulta tus cobros y descarga tus recibos y comprobantes.';

    const cuenta = dialogo?.cuenta;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="m-0 text-2xl font-medium text-texto">{titulo}</h1>
                    <p className="m-0 mt-1 text-sm text-texto-suave">{subtitulo}</p>
                </div>
                {esPropietario && <Button icono={Plus} onClick={abrirCobro}>Nuevo cobro</Button>}
            </header>

            {aviso && (
                <div aria-live="polite" className="flex flex-wrap items-center gap-3 text-sm text-texto-suave">
                    <span>{aviso.texto}</span>
                    {aviso.idComprobante && (
                        <Button variante="secundario" tamano="pequeno" icono={Download}
                            onClick={() => descargar(() => abrirComprobante(aviso.idComprobante))}>
                            Descargar comprobante
                        </Button>
                    )}
                </div>
            )}
            <FormError error={errorDescarga} />

            <div role="tablist" aria-label="Vista" className="flex flex-wrap gap-2">
                <Pestana activa={vista === 'cobros'} onClick={() => filtrar({ vista: '' })}>Cobros</Pestana>
                <Pestana activa={vista === 'movimientos'} onClick={() => filtrar({ vista: 'movimientos' })}>Movimientos</Pestana>
            </div>

            <div className="flex flex-wrap items-end gap-3">
                <Select etiqueta="Inmueble" vacio="Todos" opciones={opcionesInmueble} value={seleccion.inmueble} className="w-full sm:w-56"
                    onChange={(evento) => filtrar({ inmueble: evento.target.value, contrato: '' })} />
                <Select etiqueta="Contrato" vacio="Todos" opciones={opcionesContrato} value={seleccion.contrato} className="w-full sm:w-72"
                    onChange={(evento) => filtrar({ contrato: evento.target.value })} />
                {vista === 'movimientos' && (
                    <>
                        <DateField etiqueta="Pagos desde" value={fechas.desde} max={fechas.hasta || undefined}
                            onChange={(valor) => filtrar({ desde: valor })} />
                        <DateField etiqueta="Hasta" value={fechas.hasta} min={fechas.desde || undefined}
                            onChange={(valor) => filtrar({ hasta: valor })} />
                    </>
                )}
                <Button variante="secundario" disabled={!conFiltros}
                    onClick={() => filtrar({ inmueble: '', contrato: '', desde: '', hasta: '' })}>Limpiar</Button>
            </div>

            {vista === 'cobros' && (errorCarga ? (
                <div className="flex flex-col items-start gap-3">
                    <FormError error={errorCarga} className="w-full box-border" />
                    <Button variante="secundario" onClick={() => { setCargando(true); cargar(); }}>Reintentar</Button>
                </div>
            ) : (
                <>
                    <div role="tablist" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
                        {FILTROS.map((f) => (
                            <Pestana key={f.clave} activa={f.clave === estado.clave} tono={f.tono}
                                onClick={() => filtrar({ estado: f.clave === 'todos' ? '' : f.clave })}>
                                {f.texto} ({seleccionadas.filter((c) => cumple(f, c)).length})
                            </Pestana>
                        ))}
                    </div>
                    {!cargando && <Totales valores={totales(visibles)} />}
                    <div className="bg-superficie border border-solid border-borde rounded-tarjeta">
                        <Table
                            columnas={columnas}
                            filas={visibles}
                            claveFila="id_cuenta_cobro"
                            cargando={cargando}
                            vacio={
                                <EmptyState
                                    icono={Receipt}
                                    titulo={cuentas.length === 0 ? 'Aún no hay cobros' : 'Ningún cobro cumple los filtros'}
                                    descripcion={cuentas.length === 0
                                        ? (esPropietario
                                            ? 'El primer cobro de un contrato se genera al firmarlo; los siguientes, cada mes.'
                                            : 'Cuando tu arrendador genere un cobro, aparecerá aquí.')
                                        : 'Prueba con otro filtro.'}
                                />
                            }
                        />
                    </div>
                    {filasDesglose.length > 0 && (
                        <div className="bg-superficie border border-solid border-borde rounded-tarjeta">
                            <h2 className="m-0 px-4 pt-4 text-base font-medium text-texto">Desglose por inmueble</h2>
                            <Table columnas={columnasDesglose} filas={filasDesglose} claveFila="clave" />
                        </div>
                    )}
                </>
            ))}

            {vista === 'movimientos' && (errorMovimientos ? (
                <div className="flex flex-col items-start gap-3">
                    <FormError error={errorMovimientos} className="w-full box-border" />
                    <Button variante="secundario" onClick={cargarMovimientos}>Reintentar</Button>
                </div>
            ) : (
                <>
                    {movimientos && (
                        <div className="bg-superficie border border-solid border-borde rounded-tarjeta p-5">
                            <Dato titulo="Total confirmado">
                                <span className="tabular-nums">{formatearDinero(totalMovimientos(movimientosVisibles))}</span>
                            </Dato>
                            <p className="m-0 mt-2 text-xs text-texto-suave">Las transacciones anuladas se listan, pero no suman.</p>
                        </div>
                    )}
                    <div className="bg-superficie border border-solid border-borde rounded-tarjeta">
                        <Table
                            columnas={columnasMovimientos}
                            filas={movimientosVisibles}
                            claveFila="id_transaccion"
                            cargando={movimientos === null}
                            vacio={
                                <EmptyState icono={Receipt}
                                    titulo={movimientos?.length ? 'Ningún movimiento cumple los filtros' : 'Aún no hay movimientos'}
                                    descripcion={movimientos?.length ? 'Prueba con otro filtro.' : 'Los pagos registrados aparecerán aquí.'} />
                            }
                        />
                    </div>
                </>
            ))}

            <Modal
                abierto={dialogo?.modo === 'pagar'}
                onCerrar={cerrar}
                titulo="Registrar pago"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button type="submit" form={ID_PAGO} cargando={enviando} disabled={conErrores}>Registrar pago</Button>
                    </>
                }
            >
                {dialogo?.modo === 'pagar' && <FormularioPago cuenta={cuenta} onEnviar={pagar} onErrores={setConErrores} />}
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'cobro'}
                onCerrar={cerrar}
                titulo="Nuevo cobro"
                acciones={
                    <>
                        <Button variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Button>
                        <Button type="submit" form={ID_COBRO} cargando={enviando} disabled={conErrores}>Registrar cobro</Button>
                    </>
                }
            >
                {dialogo?.modo === 'cobro' && (
                    <div className="flex flex-col gap-4">
                        {contratosPropios === null && <FormError error="No se pudieron cargar tus contratos. Cierra e inténtalo de nuevo." />}
                        <FormularioCobro contratos={contratosPropios || []} onEnviar={cobrar} onErrores={setConErrores} />
                    </div>
                )}
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'detalle'}
                onCerrar={cerrar}
                titulo="Detalle del cobro"
                ancho="max-w-5xl"
                acciones={
                    <>
                        <Button variante="secundario" icono={FileText}
                            onClick={() => descargar(() => abrirRecibo(cuenta.id_cuenta_cobro))}>Recibo</Button>
                        {cuenta && esPropia(cuenta, sesion) && tieneSaldo(cuenta) && (
                            <Button onClick={() => abrir({ modo: 'pagar', cuenta })}>Registrar pago</Button>
                        )}
                    </>
                }
            >
                {dialogo?.modo === 'detalle' && (
                    <div className="flex flex-col gap-4">
                        <FormError error={errorDialogo || errorDescarga} />
                        <div className="flex flex-wrap gap-6 bg-lavanda rounded-control p-4">
                            <Dato titulo="Inmueble">{nombreDeInmueble(cuenta.Contrato?.Inmueble) || '—'}</Dato>
                            <Dato titulo="Periodo">{rangoDe(cuenta) ?? 'Sin periodo'}</Dato>
                            <Dato titulo="Valor">{formatearDinero(cuenta.valor)}</Dato>
                            <Dato titulo="Saldo pendiente"><Saldo cuenta={cuenta} /></Dato>
                            <Dato titulo="Estado"><Badge estado={cuenta.estado} /></Dato>
                        </div>
                        {cuenta.detalle && <p className="m-0 text-sm text-texto-suave">{cuenta.detalle}</p>}
                        <Table
                            columnas={columnasTransacciones(cuenta)}
                            filas={transacciones || []}
                            claveFila="id_transaccion"
                            cargando={transacciones === null}
                            vacio={<p className="m-0 py-6 text-center text-sm text-texto-suave">Aún no hay pagos registrados en este cobro.</p>}
                        />
                    </div>
                )}
            </Modal>

            <Modal
                abierto={dialogo?.modo === 'anular'}
                onCerrar={() => { if (!enviando) setDialogo({ modo: 'detalle', cuenta }); }}
                titulo="Anular transacción"
                acciones={
                    <>
                        <Button variante="secundario" disabled={enviando}
                            onClick={() => setDialogo({ modo: 'detalle', cuenta })}>Volver</Button>
                        <Button onClick={anular} cargando={enviando}>Anular</Button>
                    </>
                }
            >
                {dialogo?.modo === 'anular' && (
                    <div className="flex flex-col gap-3 text-sm text-texto">
                        <FormError error={errorDialogo} />
                        <p className="m-0">
                            ¿Anular el pago de <span className="font-medium">{formatearDinero(dialogo.transaccion.monto)}</span> del{' '}
                            {formatearFechaHora(dialogo.transaccion.fecha_pago)}
                            {dialogo.transaccion.medio_pago ? ` (${dialogo.transaccion.medio_pago})` : ''}?
                        </p>
                        <p className="m-0 text-texto-suave">
                            No se borra: queda marcado como anulado y el saldo del cobro se recalcula. El comprobante
                            ya emitido conserva el saldo que imprimió. Esta acción no se puede deshacer.
                        </p>
                    </div>
                )}
            </Modal>
        </div>
    );
}

