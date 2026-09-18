import Campo from './Campo';
import { CONTROL, CONTROL_CON_ERROR, unir } from './clases';

/**
 * `opciones` acepta cadenas (un catálogo de `arriendos360-contracts` tal cual)
 * u objetos `{ valor, texto }`. `vacio` añade una primera opción sin valor.
 */
export default function Select({ etiqueta, ayuda, error, id, className, opciones = [], vacio, ...resto }) {
    return (
        <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} id={id} className={className}>
            {(enlace) => (
                <select {...enlace} {...resto} className={unir(CONTROL, 'pr-8', error && CONTROL_CON_ERROR)}>
                    {vacio && <option value="">{vacio}</option>}
                    {opciones.map((opcion) => {
                        const { valor, texto } = typeof opcion === 'string' ? { valor: opcion, texto: opcion } : opcion;
                        return <option key={valor} value={valor}>{texto}</option>;
                    })}
                </select>
            )}
        </Campo>
    );
}
