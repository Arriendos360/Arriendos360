import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Building2, FileText, Home, TrendingUp } from 'lucide-react';

import { useSesion } from '../auth/sesion';
import { listarContratos } from '../features/contratos/api';
import { ordenarContratos } from '../features/contratos/filtros';
import { obtenerResumen } from '../features/dashboard/api';
import { actuaComoPropietario, nombreDeInmueble } from '../features/contratos/piezas';
import { listarCuentasCobro } from '../features/pagos/api';
import { ordenarCuentas } from '../features/pagos/desglose';
import { Button, Card, EmptyState, FormError, Paginacion, formatearDinero, formatearFecha, formatearMes, paginar } from '../ui';
import { unir } from '../ui/clases';

/**
 * Dashboard del propietario.
 *
 * Dos fuentes, y ninguna se degrada a cero: si una falla se ve el error y
 * «—» en lo que dependía de ella, nunca un «$0» que parezca una respuesta.
 *
 * - Las tarjetas salen de `GET /api/dashboard/resumen`, que agrega el gateway.
 * - «Estado de pagos» y «Cobros en mora» cuentan por `estado` las cuentas de
 *   `GET /api/pagos`, igual que los filtros de Pagos, para que las dos pantallas
 *   digan lo mismo. No se usa `/dashboard/mora`: mete el cobro del mes en curso
 *   (ver features/dashboard/api.js). Aquí no se suma dinero; cada saldo es el
 *   `saldo_pendiente` que manda el servicio.
 *
 * Quien tiene los dos roles ve sólo lo de los contratos donde es el dueño: el
 * gateway ya filtra por propietario, y de `/api/pagos` se descartan las cuentas
 * donde es inquilino (`actuaComoPropietario`).
 *
 * No hay gráfico de ingresos por mes: ninguna ruta lo da.
 */

const ESTADOS_PAGO = [
    { estado: 'PAGADA', texto: 'Pagadas', punto: 'bg-verde' },
    { estado: 'PENDIENTE', texto: 'Pendientes', punto: 'bg-ambar' },
    { estado: 'PARCIAL', texto: 'Con abonos', punto: 'bg-ambar' },
    { estado: 'EN_MORA', texto: 'En mora', punto: 'bg-rojo' }
];

/** Es un resumen con tres listas: menos filas que en las pantallas de consulta. */
const TAMANO_PAGINA_DASHBOARD = 5;

/**
 * Mide como mínimo lo que ocupa su cifra, y pasa a otra fila si no cabe: una cifra de dinero no se recorta.
 * `w-0 min-w-full` saca al título de esa medida: él sí puede partirse en dos líneas.
 */
function Tarjeta({ titulo, icono: Icono, valor, tono = 'text-texto', alerta = false }) {
    return (
        <section className="box-border flex-[1_1_11rem] min-w-fit bg-superficie border border-solid border-borde rounded-tarjeta p-5">
            <div className="flex items-start justify-between gap-3 w-0 min-w-full">
                <h2 className="m-0 text-xs font-medium uppercase tracking-label text-texto-label">{titulo}</h2>
                <span className={unir(
                    'flex items-center justify-center w-8 h-8 rounded-control shrink-0',
                    alerta ? 'bg-rojo-tenue text-rojo-texto' : 'bg-chip text-indigo-medio'
                )}>
                    <Icono size={16} aria-hidden="true" />
                </span>
            </div>
            <p className={unir('m-0 mt-3 text-3xl font-medium tabular-nums [overflow-wrap:anywhere]', tono)}>{valor}</p>
        </section>
    );
}

export default function Dashboard() {
    const sesion = useSesion();

    const [resumen, setResumen] = useState(null);
    const [errorResumen, setErrorResumen] = useState(null);
    // Cuentas de cobro donde actúa como propietario; `null` mientras cargan o si fallaron.
    const [cuentas, setCuentas] = useState(null);
    const [errorCuentas, setErrorCuentas] = useState(null);
    // Contratos con la ventana de ajuste abierta; `null` si no se pudieron pedir: la lista no se muestra.
    const [ajustes, setAjustes] = useState(null);
    // Contratos con la ventana del preaviso abierta y sin enviarlo, como los ajustes.
    const [preavisos, setPreavisos] = useState(null);
    const [cargando, setCargando] = useState(true);

    const cargar = useCallback(async () => {
        setCargando(true);
        setErrorResumen(null);
        setErrorCuentas(null);
        const [res, cue, con] = await Promise.allSettled([obtenerResumen(), listarCuentasCobro(), listarContratos()]);
        if (res.status === 'fulfilled') setResumen(res.value);
        else { setResumen(null); setErrorResumen(res.reason); }
        if (cue.status === 'fulfilled') setCuentas(cue.value.filter((c) => actuaComoPropietario(c.Contrato, sesion)));
        else { setCuentas(null); setErrorCuentas(cue.reason); }
        const contratos = con.status === 'fulfilled' ? ordenarContratos(con.value) : null;
        setAjustes(contratos && contratos.filter((c) => c.ajuste_canon?.en_ventana));
        setPreavisos(contratos && contratos.filter((c) => c.preaviso?.en_ventana && !c.preaviso.enviado));
        setCargando(false);
        // `sesion` cambia de identidad en cada render; basta con el usuario.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sesion.usuario?.id]);

    useEffect(() => { cargar(); }, [cargar]);

    const contar = (estado) => (cuentas ? cuentas.filter((c) => c.estado === estado).length : null);
    // El periodo más antiguo primero.
    const enMora = cuentas ? ordenarCuentas(cuentas.filter((c) => c.estado === 'EN_MORA')).reverse() : [];

    const [params, setParams] = useSearchParams();
    /** Cada lista tiene su parámetro: cambiar de página en una no mueve las otras. */
    const paginaDe = (filas, clave) => ({
        ...paginar(filas, params.get(clave), TAMANO_PAGINA_DASHBOARD),
        onCambiar: (numero) => setParams((actuales) => {
            const nuevos = new URLSearchParams(actuales);
            if (numero > 1) nuevos.set(clave, numero); else nuevos.delete(clave);
            return nuevos;
        }, { replace: true })
    });
    const paginaMora = paginaDe(enMora, 'pagina_mora');
    const paginaAjustes = paginaDe(ajustes ?? [], 'pagina_ajustes');
    const paginaPreavisos = paginaDe(preavisos ?? [], 'pagina_preavisos');

    // «—» mientras carga o si la fuente falló: nunca un cero que no se sabe.
    const cifra = (valor) => (valor === null || valor === undefined ? '—' : valor);

    const sinInmuebles = resumen && resumen.inmuebles.disponibles + resumen.inmuebles.arrendados === 0;
    const nombre = sesion.usuario?.nombres;

    return (
        <div className="flex flex-col gap-6">
            <header>
                <h1 className="m-0 text-2xl font-medium text-texto">{nombre ? `Bienvenido, ${nombre}` : 'Bienvenido'}</h1>
                <p className="m-0 mt-1 text-sm text-texto-suave">Resumen de tus arrendamientos.</p>
            </header>

            {errorResumen ? (
                <div className="flex flex-col items-start gap-3">
                    <FormError error={errorResumen} className="w-full box-border" />
                    <Button variante="secundario" onClick={cargar}>Reintentar</Button>
                </div>
            ) : (
                <div className="flex flex-wrap gap-4">
                    <Tarjeta titulo="Ingresos totales" icono={TrendingUp} tono="text-indigo-medio"
                        valor={cargando || !resumen ? '—' : formatearDinero(resumen.ingresos_totales)} />
                    <Tarjeta titulo="Contratos activos" icono={FileText}
                        valor={cargando || !resumen ? '—' : resumen.contratos.activos} />
                    <Tarjeta titulo="Inmuebles arrendados" icono={Home}
                        valor={cargando || !resumen ? '—' : `${resumen.inmuebles.arrendados} de ${resumen.inmuebles.disponibles + resumen.inmuebles.arrendados}`} />
                    <Tarjeta titulo="Cobros en mora" icono={AlertTriangle} alerta tono="text-rojo-texto"
                        valor={cargando ? '—' : cifra(contar('EN_MORA'))} />
                </div>
            )}

            {sinInmuebles && !cargando && (
                <Card>
                    <EmptyState
                        icono={Building2}
                        titulo="Aún no tienes inmuebles"
                        descripcion="Registra tu primer inmueble y firma un contrato para ver aquí tus cobros e ingresos."
                        accion={<Link to="/inmuebles" className="text-sm font-medium text-indigo-medio">Ir a Inmuebles</Link>}
                    />
                </Card>
            )}

            <div className="flex flex-col lg:flex-row gap-4 items-stretch">
                <Card titulo="Cobros en mora" className="flex-[2] min-w-0"
                    acciones={<Link to="/pagos" className="text-sm font-medium text-indigo-medio no-underline hover:underline">Ver pagos</Link>}>
                    {errorCuentas ? (
                        <FormError error={errorCuentas} />
                    ) : cargando || !cuentas ? (
                        <p className="m-0 py-6 text-center text-sm text-texto-suave">Cargando…</p>
                    ) : enMora.length === 0 ? (
                        <p className="m-0 py-6 text-center text-sm text-texto-suave">No tienes cobros en mora.</p>
                    ) : (
                        <>
                        <ul className="m-0 p-0 list-none flex flex-col">
                            {paginaMora.filas.map((c) => (
                                <li key={c.id_cuenta_cobro}
                                    className="flex items-center justify-between gap-4 py-3 border-0 border-b border-solid border-borde last:border-b-0">
                                    <div className="min-w-0">
                                        <p className="m-0 text-sm font-medium text-texto truncate">
                                            {nombreDeInmueble(c.Contrato?.Inmueble) || 'Inmueble sin datos'}
                                        </p>
                                        <p className="m-0 mt-0.5 text-xs text-texto-suave first-letter:uppercase">{formatearMes(c.inicio)}</p>
                                    </div>
                                    <span className="text-sm font-medium text-rojo-texto whitespace-nowrap tabular-nums">
                                        {formatearDinero(c.saldo_pendiente)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <Paginacion {...paginaMora} className="pt-3" />
                        </>
                    )}
                </Card>

                {ajustes?.length > 0 && (
                    <Card titulo="Ajustes de canon (IPC)" className="flex-1 min-w-[14rem]">
                        <ul className="m-0 p-0 list-none flex flex-col">
                            {paginaAjustes.filas.map((c) => (
                                <li key={c.id_contrato}
                                    className="flex items-center justify-between gap-4 py-3 border-0 border-b border-solid border-borde last:border-b-0">
                                    <div className="min-w-0">
                                        <Link to={`/contratos/${c.id_contrato}`}
                                            className="block text-sm font-medium text-texto no-underline hover:underline truncate">
                                            {nombreDeInmueble(c.Inmueble) || 'Inmueble sin datos'}
                                        </Link>
                                        <p className="m-0 mt-0.5 text-xs text-texto-suave">Ajuste del {formatearFecha(c.ajuste_canon.fecha_ajuste)}</p>
                                    </div>
                                    <span className="text-sm font-medium text-indigo-medio whitespace-nowrap tabular-nums">
                                        {formatearDinero(c.ajuste_canon.canon_sugerido)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <Paginacion {...paginaAjustes} className="pt-3" />
                    </Card>
                )}

                {preavisos?.length > 0 && (
                    <Card titulo="Preavisos de terminación" className="flex-1 min-w-[14rem]">
                        <ul className="m-0 p-0 list-none flex flex-col">
                            {paginaPreavisos.filas.map((c) => (
                                <li key={c.id_contrato}
                                    className="flex items-center justify-between gap-4 py-3 border-0 border-b border-solid border-borde last:border-b-0">
                                    <div className="min-w-0">
                                        <Link to={`/contratos/${c.id_contrato}`}
                                            className="block text-sm font-medium text-texto no-underline hover:underline truncate">
                                            {nombreDeInmueble(c.Inmueble) || 'Inmueble sin datos'}
                                        </Link>
                                        <p className="m-0 mt-0.5 text-xs text-texto-suave">Vence el {formatearFecha(c.preaviso.vencimiento)}</p>
                                    </div>
                                    <span className="text-sm font-medium text-ambar-texto whitespace-nowrap" title="Fecha límite del preaviso">
                                        {formatearFecha(c.preaviso.fecha_limite)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <Paginacion {...paginaPreavisos} className="pt-3" />
                    </Card>
                )}

                <Card titulo="Estado de pagos" className="flex-1 min-w-[14rem]">
                    {errorCuentas ? (
                        <p className="m-0 text-sm text-texto-suave">No se pudo consultar.</p>
                    ) : (
                        <ul className="m-0 p-0 list-none flex flex-col gap-3">
                            {ESTADOS_PAGO.map(({ estado, texto, punto }) => (
                                <li key={estado} className="flex items-center gap-2 text-sm text-texto">
                                    <span aria-hidden="true" className={unir('w-2.5 h-2.5 rounded-chip', punto)} />
                                    <span>{texto}</span>
                                    <span className="ml-auto font-medium tabular-nums">{cargando ? '—' : cifra(contar(estado))}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
        </div>
    );
}
