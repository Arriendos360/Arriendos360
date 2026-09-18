import { useEffect, useState } from 'react';

import Campo from './Campo';
import { CONTROL, CONTROL_CON_ERROR, unir } from './clases';
import { aDecimal, dineroParaEditar, leerDinero } from './formato';

/**
 * Campo de pesos colombianos. Se escribe a la colombiana («1.500.000,50») y
 * `onChange` entrega texto decimal canónico («1500000.5»), o `null` si lo
 * escrito no es un monto. Nunca un float: la conversión para el JSON la hace
 * la capa de datos, justo al enviar.
 */
export default function MoneyField({ etiqueta, ayuda, error, id, className, value, onChange, onBlur, ...resto }) {
    const [texto, setTexto] = useState(() => dineroParaEditar(value));

    // Si el valor cambia desde fuera (reiniciar el formulario), se reescribe el texto.
    useEffect(() => {
        setTexto((actual) => (leerDinero(actual) === aDecimal(value) ? actual : dineroParaEditar(value)));
    }, [value]);

    return (
        <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} id={id} className={className}>
            {(enlace) => (
                <div className="relative">
                    <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-texto-suave">$</span>
                    <input
                        {...enlace}
                        {...resto}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={texto}
                        onChange={(evento) => {
                            setTexto(evento.target.value);
                            onChange?.(leerDinero(evento.target.value), evento);
                        }}
                        onBlur={(evento) => {
                            const decimal = leerDinero(texto);
                            if (decimal !== null) setTexto(dineroParaEditar(decimal));
                            onBlur?.(evento);
                        }}
                        className={unir(CONTROL, 'pl-7 text-right tabular-nums', error && CONTROL_CON_ERROR)}
                    />
                </div>
            )}
        </Campo>
    );
}
