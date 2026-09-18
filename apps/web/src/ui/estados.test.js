import { ESTADOS_CONTRATO, ESTADOS_CUENTA_COBRO, ESTADOS_INMUEBLE, ESTADOS_TRANSACCION } from 'arriendos360-contracts';

import { ESTADOS } from './Badge';
import { mensajeDeError } from './FormError';

test('Badge conoce cada estado de los catálogos cerrados', () => {
    const catalogos = [...ESTADOS_CONTRATO, ...ESTADOS_CUENTA_COBRO, ...ESTADOS_TRANSACCION, ...ESTADOS_INMUEBLE];
    expect(catalogos.filter((estado) => !ESTADOS[estado])).toEqual([]);
});

test('los semánticos se quedan en pagos y contratos', () => {
    expect(ESTADOS.disponible.tono).not.toMatch(/verde|ambar|rojo/);
    expect(ESTADOS.arrendado.tono).not.toMatch(/verde|ambar|rojo/);
});

describe('mensajeDeError', () => {
    test('prefiere el { mensaje } de la API', () => {
        expect(mensajeDeError({ response: { status: 409, data: { mensaje: 'El inmueble tiene un contrato activo' } } }))
            .toBe('El inmueble tiene un contrato activo');
    });

    test('explica un 502 sin cuerpo y la falta de red', () => {
        expect(mensajeDeError({ response: { status: 502, data: '' } })).toMatch(/no respondió/);
        expect(mensajeDeError({ message: 'Network Error' })).toMatch(/conexión/);
    });

    test('acepta cadenas y { mensaje }, y nada con nada', () => {
        expect(mensajeDeError('Revisa el canon')).toBe('Revisa el canon');
        expect(mensajeDeError({ mensaje: 'Falta el inquilino' })).toBe('Falta el inquilino');
        expect(mensajeDeError(null)).toBeNull();
    });
});
