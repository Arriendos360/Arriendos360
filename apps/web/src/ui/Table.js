import { unir } from './clases';

const ALINEACION = { izquierda: 'text-left', derecha: 'text-right', centro: 'text-center' };

/**
 * Tabla de datos. `columnas`: `{ clave, titulo, alinear, render(fila) }`; sin
 * `render` se pinta `fila[clave]`. Las cifras de dinero van con
 * `alinear: 'derecha'` y `formatearDinero`. `vacio` se muestra si no hay filas
 * (normalmente un `EmptyState`).
 */
export default function Table({ columnas, filas, claveFila = 'id', vacio, cargando = false, className }) {
    if (!cargando && filas.length === 0 && vacio) return vacio;

    return (
        <div className={unir('overflow-x-auto', className)}>
            <table className="w-full border-collapse text-sm text-texto" aria-busy={cargando || undefined}>
                <thead>
                    <tr>
                        {columnas.map((columna) => (
                            <th
                                key={columna.clave}
                                scope="col"
                                className={unir(
                                    'px-4 py-3 bg-transparent border-0 border-b border-solid border-borde',
                                    'text-xs font-medium uppercase tracking-label text-texto-label',
                                    ALINEACION[columna.alinear || 'izquierda']
                                )}
                            >
                                {columna.titulo}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {cargando ? (
                        <tr>
                            <td colSpan={columnas.length} className="px-4 py-8 text-center text-texto-suave border-0">
                                Cargando…
                            </td>
                        </tr>
                    ) : (
                        filas.map((fila) => (
                            <tr key={typeof claveFila === 'function' ? claveFila(fila) : fila[claveFila]}>
                                {columnas.map((columna) => (
                                    <td
                                        key={columna.clave}
                                        className={unir(
                                            'px-4 py-3 border-0 border-b border-solid border-borde align-middle',
                                            columna.alinear === 'derecha' && 'tabular-nums',
                                            ALINEACION[columna.alinear || 'izquierda']
                                        )}
                                    >
                                        {columna.render ? columna.render(fila) : fila[columna.clave]}
                                    </td>
                                ))}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
