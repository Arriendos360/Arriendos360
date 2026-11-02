import { enlacesPara, etiquetaDeRoles, guardarModoNavegacion, leerModoNavegacion } from './navegacion';

const rutas = (usuario) => enlacesPara(usuario).map((enlace) => enlace.to);
const etiquetas = (usuario) => enlacesPara(usuario).map((enlace) => enlace.etiqueta);

const PROPIETARIO = { roles: ['PROPIETARIO'], rol: 'PROPIETARIO' };
const INQUILINO = { roles: ['INQUILINO'], rol: 'INQUILINO' };
const AMBOS = { roles: ['INQUILINO', 'PROPIETARIO'], rol: 'INQUILINO' };

test('el propietario ve los cuatro módulos', () => {
    expect(rutas(PROPIETARIO)).toEqual(['/', '/inmuebles', '/contratos', '/pagos']);
    expect(etiquetas(PROPIETARIO)).toEqual(['Dashboard', 'Inmuebles', 'Contratos', 'Pagos']);
});

test('el inquilino sólo ve lo suyo, en singular', () => {
    expect(rutas(INQUILINO)).toEqual(['/contratos', '/pagos']);
    expect(etiquetas(INQUILINO)).toEqual(['Mi contrato', 'Mis pagos']);
});

test('con los dos roles manda el arreglo, no el rol singular', () => {
    expect(rutas(AMBOS)).toEqual(['/', '/inmuebles', '/contratos', '/pagos']);
    expect(etiquetas(AMBOS)).toEqual(['Dashboard', 'Inmuebles', 'Contratos', 'Pagos']);
});

test('sin roles no hay enlaces', () => {
    expect(enlacesPara(null)).toEqual([]);
    expect(enlacesPara({ rol: 'PROPIETARIO' })).toEqual([]);
});

test('la etiqueta de roles sigue un orden fijo', () => {
    expect(etiquetaDeRoles(PROPIETARIO)).toBe('Propietario');
    expect(etiquetaDeRoles(INQUILINO)).toBe('Inquilino');
    expect(etiquetaDeRoles(AMBOS)).toBe('Propietario · Inquilino');
    expect(etiquetaDeRoles(null)).toBe('');
});

describe('preferencia de modo', () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(() => jest.restoreAllMocks());

    test('sin valor usa la barra lateral', () => {
        expect(leerModoNavegacion()).toBe('sidebar');
    });

    test.each(['dock', 'sidebar'])('lee %s tal como se guardó', (modo) => {
        guardarModoNavegacion(modo);
        expect(window.localStorage.getItem('app_nav_mode')).toBe(modo);
        expect(leerModoNavegacion()).toBe(modo);
    });

    test('un valor desconocido usa la barra lateral', () => {
        window.localStorage.setItem('app_nav_mode', 'flotante');
        expect(leerModoNavegacion()).toBe('sidebar');
    });

    test('un almacenamiento bloqueado no rompe ni la lectura ni la escritura', () => {
        const bloqueado = () => {
            throw new Error('SecurityError');
        };
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(bloqueado);
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(bloqueado);

        expect(leerModoNavegacion()).toBe('sidebar');
        expect(() => guardarModoNavegacion('dock')).not.toThrow();
    });
});
