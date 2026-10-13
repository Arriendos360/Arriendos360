/**
 * Estado del contrato en pantalla: la indemnización sugerida al cancelar, la mora que se advierte
 * antes de terminar y las filas del historial.
 */

import { MOTIVOS_CANCELACION } from 'arriendos360-contracts';

import { ESTADOS } from '../../ui/Badge';
import { aDecimal, formatearDinero, formatearFecha, formatearFechaHora } from '../../ui/formato';

/** Un monto a centavos enteros, para sumar y multiplicar sin flotantes. */
const centavos = (valor) => Math.round(Number(aDecimal(valor) ?? 0) * 100);

const comoDecimal = (enCentavos) => (enCentavos / 100).toFixed(2);

/** Quién paga la indemnización, para el selector del diálogo. */
export const OPCIONES_A_CARGO_DE = [
    { valor: 'INQUILINO', texto: 'El arrendatario' },
    { valor: 'PROPIETARIO', texto: 'El arrendador' }
];

const A_CARGO = { INQUILINO: 'del arrendatario', PROPIETARIO: 'del arrendador' };

/** Los motivos que admite el contrato: la unilateral del arrendador sólo en la prórroga. */
export const motivosPara = (situacion) =>
    Object.entries(MOTIVOS_CANCELACION)
        .filter(([, motivo]) => !motivo.solo_en_prorroga || situacion === 'renovado')
        .map(([valor, motivo]) => ({ valor, texto: motivo.etiqueta }));

/** El sugerido de un motivo: canon × cánones, y quién lo paga. Es pactable: sólo prellena. */
export const indemnizacionSugerida = (clave, canon) => {
    const motivo = MOTIVOS_CANCELACION[clave];
    if (!motivo) return { valor: null, a_cargo_de: '' };
    return { valor: comoDecimal(centavos(canon) * motivo.canones_sugeridos), a_cargo_de: motivo.a_cargo_de ?? '' };
};

/** Las cuentas `EN_MORA` de un contrato y la suma de sus saldos. */
export const resumenDeMora = (cuentas) => {
    const enMora = cuentas.filter((cuenta) => cuenta.estado === 'EN_MORA');
    return {
        cantidad: enMora.length,
        total: comoDecimal(enMora.reduce((suma, cuenta) => suma + centavos(cuenta.saldo_pendiente), 0))
    };
};

/**
 * El primer día desde `hoy` en que el contrato no tiene una cuenta que empiece: el alta manual
 * exige un `inicio` único por contrato, y un día de corte ya lo ocupa la cuenta del periodo.
 */
export const primerInicioLibre = (cuentas, hoy) => {
    const usados = new Set(cuentas.map((cuenta) => cuenta.inicio));
    let dia = hoy;
    while (usados.has(dia)) dia = new Date(Date.parse(`${dia}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    return dia;
};

/** La advertencia del diálogo. Si la consulta falló, lo dice: nunca «sin mora» por omisión. */
export const textoDeMora = ({ cargando, error, cuentas }) => {
    if (cargando) return 'Comprobando si hay cuentas en mora…';
    if (error) return 'No se pudo comprobar si hay cuentas en mora.';
    const { cantidad, total } = resumenDeMora(cuentas);
    if (cantidad === 0) return 'No hay cuentas en mora.';
    return `${cantidad} ${cantidad === 1 ? 'cuenta' : 'cuentas'} en mora por ${formatearDinero(total)}. Lo que se debe sigue pendiente de cobro.`;
};

const ETIQUETA_CAMPO = {
    canon: 'Canon',
    fin: 'Fecha de fin',
    fecha_limite_pago: 'Día límite de pago',
    info_contrato: 'Condiciones particulares',
    nombre_deudor_solidario: 'Deudor solidario',
    documento_deudor_solidario: 'Documento del deudor',
    estado: 'Estado'
};

const valorDe = (campo, valor) => {
    if (valor === null || valor === undefined) return '—';
    if (campo === 'canon') return formatearDinero(valor);
    if (campo === 'fin') return formatearFecha(valor);
    if (campo === 'estado') return ESTADOS[valor]?.texto ?? valor;
    return valor;
};

/** Una fila del historial como se pinta. En una cancelación, `detalle` lleva el motivo y la indemnización. */
export const filaDeHistorial = (fila) => {
    const motivo = MOTIVOS_CANCELACION[fila.motivo];
    const indemnizacion = centavos(fila.indemnizacion) > 0
        ? `indemnización de ${formatearDinero(fila.indemnizacion)} a cargo ${A_CARGO[fila.indemnizacion_a_cargo_de] ?? 'de —'}`
        : 'sin indemnización';
    return {
        fecha: formatearFechaHora(fila.cambiado_en),
        campo: ETIQUETA_CAMPO[fila.campo] ?? fila.campo,
        anterior: valorDe(fila.campo, fila.valor_anterior),
        nuevo: valorDe(fila.campo, fila.valor_nuevo),
        detalle: motivo ? `${motivo.etiqueta}, ${indemnizacion}.` : null
    };
};
