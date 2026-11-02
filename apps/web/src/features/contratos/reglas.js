/** Reglas del formulario de nuevo contrato: los pasos del flujo y las de los servicios. */

import {
    cuentasPendientes, mesAnteriorAlPrimero, mesesElegibles, pideUltimoAjuste, pideUltimoMesPagado,
    validarAltaInquilino, validarContrato
} from 'arriendos360-contracts';

import { aDecimal, formatearDinero, formatearFecha } from '../../ui/formato';
import { aMapa } from '../../ui/validacion';

/** El error de cédula del documento del inquilino, o `undefined`. Se mira antes de buscarlo. */
export const errorDeDocumento = (documento) => aMapa(validarAltaInquilino({ documento }).errores).documento;

/** Errores del contrato en el orden de la pantalla. `inquilino` es el ya encontrado o dado de alta; `hoy`, `hoyEnBogota()`. */
export const validarFormularioContrato = (form, inquilino, hoy) => {
    const documento = inquilino ? undefined : errorDeDocumento(form.documento) ?? 'Busca al inquilino por su documento o dalo de alta.';
    return [
        ...(form.id_inmueble ? [] : [{ campo: 'id_inmueble', mensaje: 'Elige el inmueble.' }]),
        ...(documento ? [{ campo: 'documento', mensaje: documento }] : []),
        ...validarContrato(form, hoy).errores
    ];
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lo que se le pregunta a un contrato que ya lleva tiempo corriendo. `meses` son los periodos
 * elegibles para el selector y `pendientes`, las cuentas que creará lo elegido; `null` mientras no aplique.
 */
export const antiguedadDelContrato = (form, hoy) => {
    if (!FECHA.test(form.inicio)) return { pideMes: false, pideAjuste: false, meses: [], pendientes: null };

    const primerCorte = FECHA.test(form.fecha_inicio_corte) ? form.fecha_inicio_corte : form.inicio;
    const pideMes = pideUltimoMesPagado(form.inicio, primerCorte, hoy);
    const meses = pideMes ? mesesElegibles(primerCorte, hoy) : [];
    const elegido = form.nunca_pagado
        ? mesAnteriorAlPrimero(primerCorte)
        : meses.find(({ mes }) => mes === form.ultimo_periodo_pagado)?.mes;

    return {
        pideMes,
        pideAjuste: pideUltimoAjuste(form.inicio, hoy),
        meses: meses.map(({ mes, inicio, fin }) => ({ valor: mes, texto: `${formatearFecha(inicio)} – ${formatearFecha(fin)}` })),
        pendientes: pideMes && elegido ? cuentasPendientes(Number(primerCorte.slice(8, 10)), elegido, hoy) : null
    };
};

/** El aviso previo a firmar: lo que se creará, porque después no se puede anular desde la aplicación. */
export const avisoDeCuentas = (cuentas, canon) => {
    if (cuentas.length === 0) return 'No se creará ninguna cuenta: el contrato está al día.';

    const cuantas = cuentas.length === 1 ? 'Se creará 1 cuenta pendiente' : `Se crearán ${cuentas.length} cuentas pendientes`;
    const rango = `del ${formatearFecha(cuentas[0].inicio)} al ${formatearFecha(cuentas[cuentas.length - 1].fin)}`;
    const total = aDecimal(canon) === null ? '' : `, por ${formatearDinero((Number(canon) * cuentas.length).toFixed(2))} en total`;
    return `${cuantas}, ${rango}${total}. Revísalo antes de firmar: no se puede anular desde la aplicación.`;
};

/** Alta del inquilino que no existía: su documento es el que se buscó. */
export const validarAlta = (alta) => validarAltaInquilino(alta).errores;
