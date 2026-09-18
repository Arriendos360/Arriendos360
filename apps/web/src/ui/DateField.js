import Input from './Input';

/**
 * Fecha de calendario `YYYY-MM-DD`, el formato que piden `inicio`, `fin` y
 * `fecha_inicio_corte`. El valor viaja como texto: nunca pasa por `Date`, que
 * lo interpretaría en la zona del navegador. Para «hoy» usa `hoyEnBogota()`.
 *
 * No sirve para `fecha_limite_pago`, que es un día del mes (entero).
 */
export default function DateField({ onChange, ...resto }) {
    return <Input type="date" onChange={(evento) => onChange?.(evento.target.value, evento)} {...resto} />;
}
