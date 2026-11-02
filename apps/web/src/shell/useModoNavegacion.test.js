import { act } from 'react';
import { createRoot } from 'react-dom/client';

import useModoNavegacion from './useModoNavegacion';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CUADRO_MS = 16;

let raiz;
let actual;

function Sonda() {
    actual = useModoNavegacion();
    return null;
}

const montar = () => {
    raiz = createRoot(document.createElement('div'));
    act(() => raiz.render(<Sonda />));
};

const avanzar = (ms) => act(() => {
    jest.advanceTimersByTime(ms);
});

beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    delete window.matchMedia;
    montar();
});

afterEach(() => {
    act(() => raiz.unmount());
    jest.useRealTimers();
});

test('sale, cambia de modo a los 300 ms y entra', () => {
    expect(actual).toMatchObject({ modo: 'sidebar', fase: 'estable' });

    act(() => actual.alternar());
    expect(actual).toMatchObject({ modo: 'sidebar', fase: 'saliendo' });

    avanzar(299);
    expect(actual).toMatchObject({ modo: 'sidebar', fase: 'saliendo' });

    avanzar(1);
    expect(actual).toMatchObject({ modo: 'dock', fase: 'preparando' });

    avanzar(CUADRO_MS * 2);
    expect(actual).toMatchObject({ modo: 'dock', fase: 'entrando' });

    avanzar(300);
    expect(actual).toMatchObject({ modo: 'dock', fase: 'estable' });
});

test('pulsar durante el ciclo no hace nada', () => {
    act(() => actual.alternar());
    act(() => actual.alternar());
    avanzar(300);
    expect(actual.modo).toBe('dock');

    act(() => actual.alternar());
    avanzar(CUADRO_MS * 2);
    expect(actual).toMatchObject({ modo: 'dock', fase: 'entrando' });

    act(() => actual.alternar());
    expect(actual).toMatchObject({ modo: 'dock', fase: 'entrando' });
    expect(window.localStorage.getItem('app_nav_mode')).toBe('dock');
});

test('con movimiento reducido cambia de inmediato', () => {
    window.matchMedia = () => ({ matches: true });

    act(() => actual.alternar());

    expect(actual).toMatchObject({ modo: 'dock', fase: 'estable' });
    expect(jest.getTimerCount()).toBe(0);
});

test('guarda el modo elegido y lo recupera al montar', () => {
    act(() => actual.alternar());
    expect(window.localStorage.getItem('app_nav_mode')).toBe('dock');

    act(() => raiz.unmount());
    montar();
    expect(actual).toMatchObject({ modo: 'dock', fase: 'estable' });
});

test.each([
    ['saliendo', []],
    ['preparando', [300]],
    ['entrando', [300, CUADRO_MS * 2]]
])('desmontar en la fase %s no deja temporizadores', (fase, pasos) => {
    act(() => actual.alternar());
    pasos.forEach(avanzar);
    expect(actual.fase).toBe(fase);
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    act(() => raiz.unmount());
    expect(jest.getTimerCount()).toBe(0);
    montar();
});
