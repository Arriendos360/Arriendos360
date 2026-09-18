/**
 * Único sitio donde la SPA da formato a dinero y fechas.
 *
 * Dinero: pesos colombianos. La API lo guarda en `NUMERIC` y lo devuelve como
 * número o como cadena ("1500000.00"); aquí se trata como texto decimal y nunca
 * se pasa por `parseFloat`, para no pintar un 1.499.999,99.
 *
 * Fechas: se guardan en UTC y se presentan en `America/Bogota`. Una fecha sin
 * hora (`YYYY-MM-DD`: `inicio`, `fin`, `fecha_inicio_corte`) es un día de
 * calendario y se pinta tal cual, sin zona: convertirla la correría un día.
 */

export const ZONA_NEGOCIO = 'America/Bogota';

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Normaliza un monto de la API a texto decimal canónico ("1500000.5").
 * Devuelve `null` si no es un monto.
 */
export function aDecimal(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const texto = typeof valor === 'number' ? String(valor) : String(valor).trim();
    // Un número JSON muy grande o muy pequeño llega en notación científica.
    if (!DECIMAL.test(texto)) return null;
    const [, signo, entero, fraccion = ''] = texto.match(DECIMAL);
    const enteroLimpio = entero.replace(/^0+(?=\d)/, '');
    const fraccionLimpia = fraccion.replace(/0+$/, '');
    const cero = enteroLimpio === '0' && fraccionLimpia === '';
    return `${cero ? '' : signo}${enteroLimpio}${fraccionLimpia ? `.${fraccionLimpia}` : ''}`;
}

function agruparMiles(entero) {
    return entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * "$ 1.500.000" o "$ 1.500.000,50". Los centavos sólo aparecen si existen.
 * Un valor ausente o ilegible se pinta "—", nunca "$ 0": un cero inventado miente.
 */
export function formatearDinero(valor) {
    const decimal = aDecimal(valor);
    if (decimal === null) return '—';
    const [, signo, entero, fraccion = ''] = decimal.match(DECIMAL);
    const centavos = fraccion ? `,${fraccion.padEnd(2, '0').slice(0, 2)}` : '';
    return `${signo ? '-' : ''}$ ${agruparMiles(entero)}${centavos}`;
}

/**
 * Lee lo que alguien escribe en un campo de dinero ("1.500.000", "1500000,5",
 * "$ 2.000") y devuelve texto decimal canónico, o `null` si no es un monto.
 * El punto es separador de miles y la coma, decimal, como se escribe en Colombia.
 */
export function leerDinero(texto) {
    if (texto === null || texto === undefined) return null;
    const limpio = String(texto).replace(/[$\s.]/g, '');
    if (!/^\d+(,\d{0,2})?$/.test(limpio)) return null;
    return aDecimal(limpio.replace(',', '.').replace(/\.$/, ''));
}

/** Monto en el formato de edición: "1.500.000,5", sin símbolo. */
export function dineroParaEditar(valor) {
    const decimal = aDecimal(valor);
    if (decimal === null) return '';
    const [, signo, entero, fraccion] = decimal.match(DECIMAL);
    return `${signo}${agruparMiles(entero)}${fraccion ? `,${fraccion}` : ''}`;
}

function partesEnZona(fecha) {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA_NEGOCIO,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(fecha);
    const de = (tipo) => partes.find((p) => p.type === tipo).value;
    return { anio: de('year'), mes: de('month'), dia: de('day'), hora: de('hour'), minuto: de('minute') };
}

function aFechaValida(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const fecha = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * "5 mar 2026". Acepta `YYYY-MM-DD` (día de calendario, sin zona) o un instante
 * ISO con hora, que se lleva a `America/Bogota`.
 */
export function formatearFecha(valor) {
    if (typeof valor === 'string' && FECHA_ISO.test(valor)) {
        const [, anio, mes, dia] = valor.match(FECHA_ISO);
        return `${Number(dia)} ${MESES[Number(mes) - 1]} ${anio}`;
    }
    const fecha = aFechaValida(valor);
    if (!fecha) return '—';
    const { anio, mes, dia } = partesEnZona(fecha);
    return `${Number(dia)} ${MESES[Number(mes) - 1]} ${anio}`;
}

/** "5 mar 2026, 14:30", en hora de Bogotá. Para `fecha_pago` y la auditoría. */
export function formatearFechaHora(valor) {
    const fecha = aFechaValida(valor);
    if (!fecha || (typeof valor === 'string' && FECHA_ISO.test(valor))) return formatearFecha(valor);
    const { hora, minuto } = partesEnZona(fecha);
    return `${formatearFecha(fecha)}, ${hora}:${minuto}`;
}

/** Hoy en Bogotá como `YYYY-MM-DD`, no en la zona del navegador. */
export function hoyEnBogota(ahora = new Date()) {
    const { anio, mes, dia } = partesEnZona(ahora);
    return `${anio}-${mes}-${dia}`;
}

const MESES_LARGOS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/** «agosto 2026», el mes de un periodo. Se lee del texto `YYYY-MM-DD`, sin zona. */
export function formatearMes(valor) {
    const partes = typeof valor === 'string' ? valor.match(FECHA_ISO) : null;
    return partes ? `${MESES_LARGOS[Number(partes[2]) - 1]} ${partes[1]}` : '—';
}
