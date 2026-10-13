/**
 * Registro financiero desagregado (RF-21): filtros, totales y desglose de las cuentas de cobro y de
 * los movimientos. Lógica pura: la página sólo la pinta. Todo el dinero se suma al centavo.
 */

import { diaEnZona, restarDinero, sumarDinero } from '../../ui/formato';

/** Las pestañas de estado de las cuentas. */
export const FILTROS = [
    { clave: 'todos', texto: 'Todos', estados: null, tono: 'text-texto-suave' },
    { clave: 'pendientes', texto: 'Pendientes', estados: ['PENDIENTE', 'PARCIAL'], tono: 'text-ambar-texto' },
    { clave: 'pagados', texto: 'Pagados', estados: ['PAGADA'], tono: 'text-verde-texto' },
    { clave: 'mora', texto: 'En mora', estados: ['EN_MORA'], tono: 'text-rojo-texto' }
];

export const cumple = (filtro, cuenta) => !filtro.estados || filtro.estados.includes(cuenta.estado);

/** ¿Es la cuenta del inmueble y del contrato elegidos? Sin contrato compuesto, no se sabe de qué inmueble es. */
const deLaSeleccion = (cuenta, { inmueble, contrato }) =>
    (!inmueble || cuenta?.Contrato?.id_inmueble === inmueble) && (!contrato || cuenta?.id_contrato === contrato);

// shortcut: filtra en memoria lo que trae la API; si un portafolio pasa de unos miles de cuentas, mover los filtros a parámetros del servidor.
export const filtrarCuentas = (cuentas, filtros) => {
    const estado = FILTROS.find((f) => f.clave === filtros.estado) ?? FILTROS[0];
    return cuentas.filter((cuenta) => deLaSeleccion(cuenta, filtros) && cumple(estado, cuenta));
};

/** Las fechas se comparan por el día en Bogotá: un pago de las 22:00 no se pasa al día siguiente. */
export const filtrarMovimientos = (transacciones, { desde, hasta, ...seleccion }) =>
    transacciones.filter((t) => {
        const dia = diaEnZona(t.fecha_pago);
        return deLaSeleccion(t.CuentaCobro, seleccion) && (!desde || dia >= desde) && (!hasta || dia <= hasta);
    });

/** Facturado, pendiente, recaudado (facturado − pendiente) y en mora. `null` en lo que no se pudo sumar. */
export const totales = (cuentas) => {
    const facturado = sumarDinero(...cuentas.map((c) => c.valor));
    const pendiente = sumarDinero(...cuentas.map((c) => c.saldo_pendiente));
    return {
        facturado,
        pendiente,
        recaudado: restarDinero(facturado, pendiente),
        en_mora: sumarDinero(...cuentas.filter((c) => c.estado === 'EN_MORA').map((c) => c.saldo_pendiente))
    };
};

/** Lo recaudado según los movimientos: sólo los confirmados; los anulados se ven pero no suman. */
export const totalMovimientos = (transacciones) =>
    sumarDinero(...transacciones.filter((t) => t.estado === 'CONFIRMADA').map((t) => t.monto));

const nombre = (fila) => fila.inmueble?.alias || fila.inmueble?.direccion || '';

const agrupar = (lista, clave) => {
    const grupos = new Map();
    for (const elemento of lista) grupos.set(clave(elemento), [...(grupos.get(clave(elemento)) ?? []), elemento]);
    return [...grupos.values()];
};

/**
 * Una fila por inmueble y, dentro, una por contrato, con sus totales. Las cuentas sin contrato
 * compuesto van al grupo `sinContrato`, al final: se ven y suman, no se omiten.
 */
export const desglosar = (cuentas) =>
    agrupar(cuentas, (c) => c.Contrato?.id_inmueble ?? null)
        .map((grupo) => ({
            inmueble: grupo[0].Contrato?.Inmueble ?? null,
            sinContrato: !grupo[0].Contrato,
            totales: totales(grupo),
            contratos: agrupar(grupo, (c) => c.id_contrato).map((delContrato) => ({
                id_contrato: delContrato[0].id_contrato,
                contrato: delContrato[0].Contrato ?? null,
                totales: totales(delContrato)
            }))
        }))
        .sort((a, b) => Number(a.sinContrato) - Number(b.sinContrato) || nombre(a).localeCompare(nombre(b)));
