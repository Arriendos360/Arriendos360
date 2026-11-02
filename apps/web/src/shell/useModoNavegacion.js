import { useEffect, useState } from 'react';

import { guardarModoNavegacion, leerModoNavegacion, MODO_BARRA, MODO_DOCK } from './navegacion';

// Igual a `duration-300` de las clases de la barra y del dock.
const DURACION_MS = 300;

export const FASE_ESTABLE = 'estable';
export const FASE_SALIENDO = 'saliendo';
export const FASE_PREPARANDO = 'preparando';
export const FASE_ENTRANDO = 'entrando';

/** Fases en que el elemento de navegación está fuera de su sitio y no recibe pulsaciones. */
export const estaOculto = (fase) => fase === FASE_SALIENDO || fase === FASE_PREPARANDO;

const opuesto = (modo) => (modo === MODO_DOCK ? MODO_BARRA : MODO_DOCK);
const prefiereMenosMovimiento = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Modo de navegación y ciclo de su cambio: sale el elemento actual, cambia el modo
 * y entra el nuevo. Pulsar durante el ciclo no hace nada.
 */
export default function useModoNavegacion() {
    const [modo, setModo] = useState(leerModoNavegacion);
    const [fase, setFase] = useState(FASE_ESTABLE);

    useEffect(() => {
        if (fase === FASE_SALIENDO) {
            const temporizador = setTimeout(() => {
                setModo(opuesto);
                setFase(FASE_PREPARANDO);
            }, DURACION_MS);
            return () => clearTimeout(temporizador);
        }
        if (fase === FASE_PREPARANDO) {
            // Dos cuadros: el navegador debe pintar la posición de partida para que haya transición.
            let cuadro = requestAnimationFrame(() => {
                cuadro = requestAnimationFrame(() => setFase(FASE_ENTRANDO));
            });
            return () => cancelAnimationFrame(cuadro);
        }
        if (fase === FASE_ENTRANDO) {
            const temporizador = setTimeout(() => setFase(FASE_ESTABLE), DURACION_MS);
            return () => clearTimeout(temporizador);
        }
        return undefined;
    }, [fase]);

    const alternar = () => {
        if (fase !== FASE_ESTABLE) return;
        guardarModoNavegacion(opuesto(modo));
        if (prefiereMenosMovimiento()) {
            setModo(opuesto);
        } else {
            setFase(FASE_SALIENDO);
        }
    };

    return { modo, fase, alternar };
}
