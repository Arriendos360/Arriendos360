import { enlacesPara, etiquetaDeRoles } from './navegacion';

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
