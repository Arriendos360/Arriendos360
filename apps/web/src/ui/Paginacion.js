import Button from './Button';
import { unir } from './clases';

/**
 * Rango y botones de una lista paginada con `paginar()`. Con una sola página no se muestra.
 * `className` reemplaza el relleno: dentro de una `Card` se sumaría al de la tarjeta.
 */
export default function Paginacion({ pagina, totalPaginas, desde, hasta, total, onCambiar, className = 'px-4 py-3' }) {
    if (totalPaginas <= 1) return null;

    return (
        <nav aria-label="Paginación" className={unir('flex flex-wrap items-center justify-between gap-3', className)}>
            <p aria-live="polite" className="m-0 text-sm tabular-nums text-texto-suave">{desde}–{hasta} de {total}</p>
            <div className="flex gap-2">
                <Button variante="secundario" tamano="pequeno" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>
                    Anterior
                </Button>
                <Button variante="secundario" tamano="pequeno" disabled={pagina >= totalPaginas} onClick={() => onCambiar(pagina + 1)}>
                    Siguiente
                </Button>
            </div>
        </nav>
    );
}
