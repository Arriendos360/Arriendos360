/** Paginación en memoria de una lista ya filtrada. Lógica pura: la página sólo la pinta. */

export const TAMANO_PAGINA = 10;

/**
 * La página pedida de `filas`, con su rango. `paginaPedida` llega de la URL: la inválida vale 1 y la
 * excesiva, la última, que también cubre la última página que se queda sin filas tras recargar.
 */
export const paginar = (filas, paginaPedida, tamano = TAMANO_PAGINA) => {
    const total = filas.length;
    const totalPaginas = Math.max(Math.ceil(total / tamano), 1);
    const pagina = Math.min(Math.max(Math.trunc(Number(paginaPedida)) || 1, 1), totalPaginas);
    const inicio = (pagina - 1) * tamano;
    const visibles = filas.slice(inicio, inicio + tamano);

    return {
        filas: visibles,
        pagina,
        totalPaginas,
        desde: total ? inicio + 1 : 0,
        hasta: inicio + visibles.length,
        total
    };
};
