import { FOCO, unir } from './clases';

const VARIANTES = {
    primario: 'bg-indigo-medio text-white border-indigo-medio hover:bg-indigo-hover hover:border-indigo-hover',
    secundario: 'bg-superficie text-indigo-medio border-borde hover:bg-lavanda',
    fantasma: 'bg-transparent text-indigo-medio border-transparent hover:bg-lavanda'
};

const TAMANOS = {
    normal: 'h-10 px-4 text-sm',
    pequeno: 'h-8 px-3 text-xs'
};

/**
 * Botón de la marca. `type="button"` por defecto: dentro de un formulario, un
 * botón sin tipo lo envía, y eso sólo debe pasar cuando se pide `type="submit"`.
 */
export default function Button({
    variante = 'primario',
    tamano = 'normal',
    cargando = false,
    icono: Icono,
    type = 'button',
    disabled,
    className,
    children,
    ...resto
}) {
    return (
        <button
            type={type}
            disabled={disabled || cargando}
            aria-busy={cargando || undefined}
            className={unir(
                'box-border inline-flex items-center justify-center gap-2 m-0 font-sans font-medium',
                'border border-solid rounded-control cursor-pointer whitespace-nowrap',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                FOCO,
                VARIANTES[variante],
                TAMANOS[tamano],
                className
            )}
            {...resto}
        >
            {Icono && <Icono size={16} aria-hidden="true" />}
            {cargando ? 'Procesando…' : children}
        </button>
    );
}
