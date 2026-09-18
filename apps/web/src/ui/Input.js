import Campo from './Campo';
import { CONTROL, CONTROL_CON_ERROR, unir } from './clases';

export default function Input({ etiqueta, ayuda, error, id, className, ...resto }) {
    return (
        <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} id={id} className={className}>
            {(enlace) => (
                <input {...enlace} {...resto} className={unir(CONTROL, error && CONTROL_CON_ERROR)} />
            )}
        </Campo>
    );
}
