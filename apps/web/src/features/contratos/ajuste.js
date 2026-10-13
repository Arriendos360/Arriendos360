/** Ajuste anual del canon por IPC: lo que la pantalla muestra de `ajuste_canon`. */

import { formatearFecha } from '../../ui/formato';

/** `5.1` → «5,10 % (2025)». */
const ipcConAnio = (ajuste) =>
    `${ajuste.ipc.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} % (${ajuste.anio_ipc})`;

/** `null` si el contrato no trae `ajuste_canon` (no es del propietario o no está activo). */
export const resumenDeAjuste = (ajuste) => {
    if (!ajuste) return null;

    const sinIpc = ajuste.ipc === null;
    return {
        fecha: formatearFecha(ajuste.fecha_ajuste),
        ipc: sinIpc ? null : ipcConAnio(ajuste),
        sugerido: ajuste.canon_sugerido,
        puedeAplicar: ajuste.en_ventana,
        estado: sinIpc
            ? `Falta el IPC de ${ajuste.anio_ipc}: sin él no hay canon sugerido.`
            : ajuste.en_ventana
                ? 'Ya puedes aplicar el ajuste. Al guardarlo se avisará al inquilino.'
                : `Podrás aplicarlo desde el ${formatearFecha(ajuste.ventana_desde)}.`
    };
};
