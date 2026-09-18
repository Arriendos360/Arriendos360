/**
 * Clases compartidas por los controles del kit. El preflight de Tailwind está
 * apagado mientras viva App.css, así que cada control declara su borde, fuente y
 * margen en vez de heredarlos de un reset.
 */

export const unir = (...clases) => clases.filter(Boolean).join(' ');

// Foco visible con `outline`: `ring` de Tailwind es una sombra y la marca no las admite.
export const FOCO = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-medio';

export const CONTROL = unir(
    'box-border block w-full m-0 h-10 px-3 font-sans text-sm text-texto bg-superficie',
    'border border-solid border-borde rounded-control',
    'focus:outline focus:outline-1 focus:outline-indigo-medio focus:border-indigo-medio',
    'disabled:bg-lavanda disabled:text-texto-suave'
);

export const CONTROL_CON_ERROR = 'border-rojo-texto';

export const ETIQUETA = 'block m-0 mb-1.5 text-xs font-medium uppercase tracking-label text-texto-label';
