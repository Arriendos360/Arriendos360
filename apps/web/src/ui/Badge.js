import { unir } from './clases';

/**
 * Único componente que usa los colores semánticos (marca.md): verde, ámbar y
 * rojo sólo para estados de pago y de contrato. Los estados vienen tal cual los
 * devuelve la API: minúsculas los de Contratos e Inmuebles, MAYÚSCULAS los de
 * Financiero.
 */
const TONOS = {
    verde: 'bg-verde-tenue text-verde-texto',
    ambar: 'bg-ambar-tenue text-ambar-texto',
    rojo: 'bg-rojo-tenue text-rojo-texto',
    neutro: 'bg-borde text-texto-suave',
    marca: 'bg-chip text-indigo-medio'
};

export const ESTADOS = {
    // Contratos
    activo: { tono: 'verde', texto: 'Activo' },
    finalizado: { tono: 'neutro', texto: 'Finalizado' },
    cancelado: { tono: 'neutro', texto: 'Cancelado' },
    // Cuentas de cobro
    PENDIENTE: { tono: 'ambar', texto: 'Pendiente' },
    PARCIAL: { tono: 'ambar', texto: 'Parcial' },
    PAGADA: { tono: 'verde', texto: 'Pagada' },
    EN_MORA: { tono: 'rojo', texto: 'En mora' },
    // Transacciones
    CONFIRMADA: { tono: 'verde', texto: 'Confirmada' },
    ANULADA: { tono: 'neutro', texto: 'Anulada' },
    // Inmuebles: no es un estado de pago ni de contrato, así que sin semánticos.
    disponible: { tono: 'marca', texto: 'Disponible' },
    arrendado: { tono: 'neutro', texto: 'Arrendado' }
};

export default function Badge({ estado, children, className }) {
    const conocido = ESTADOS[estado];
    return (
        <span
            className={unir(
                'inline-flex items-center h-6 px-2.5 rounded-chip text-xs font-medium whitespace-nowrap',
                TONOS[conocido?.tono || 'neutro'],
                className
            )}
        >
            {children || conocido?.texto || estado}
        </span>
    );
}
