import { unir } from './clases';

/** Tarjeta de superficie blanca. Sin sombra: la separa el borde. */
export default function Card({ titulo, acciones, className, children }) {
    return (
        <section className={unir('box-border bg-superficie border border-solid border-borde rounded-tarjeta p-5', className)}>
            {(titulo || acciones) && (
                <header className="flex items-center justify-between gap-3 mb-4">
                    {titulo && <h2 className="m-0 text-lg font-medium text-texto">{titulo}</h2>}
                    {acciones && <div className="flex items-center gap-2">{acciones}</div>}
                </header>
            )}
            {children}
        </section>
    );
}
