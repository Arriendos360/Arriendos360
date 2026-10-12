import { aMapa, errorDeCampo, erroresDelServidor } from './validacion';

const errorHttp = (status, data) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

describe('aMapa', () => {
    test('un mensaje por campo, el primero', () => {
        expect(aMapa([
            { campo: 'documento', mensaje: 'primero' },
            { campo: 'documento', mensaje: 'segundo' },
            { campo: 'email', mensaje: 'otro' }
        ])).toEqual({ documento: 'primero', email: 'otro' });
    });
});

describe('errorDeCampo', () => {
    test('sólo el del campo pedido', () => {
        const validar = () => [{ campo: 'nombres', mensaje: 'mal' }, { campo: 'email', mensaje: 'también' }];
        expect(errorDeCampo(validar, {}, 'email')).toBe('también');
        expect(errorDeCampo(validar, {}, 'telefono')).toBeUndefined();
    });
});

describe('erroresDelServidor', () => {
    const campos = ['nombres', 'documento'];

    test('reparte un 400 con errores bajo sus campos', () => {
        const error = errorHttp(400, {
            mensaje: 'El documento ya está registrado',
            errores: [{ campo: 'documento', mensaje: 'El documento ya está registrado' }]
        });
        expect(erroresDelServidor(error, campos)).toEqual({
            errores: { documento: 'El documento ya está registrado' },
            general: null
        });
    });

    test('un campo que no está en pantalla va a lo general', () => {
        const error = errorHttp(400, {
            errores: [{ campo: 'nombres', mensaje: 'mal' }, { campo: 'id_inquilino', mensaje: 'fuera' }]
        });
        expect(erroresDelServidor(error, campos)).toEqual({ errores: { nombres: 'mal' }, general: 'fuera' });
    });

    test('un 502, o un 400 sin errores, no se reparte', () => {
        expect(erroresDelServidor(errorHttp(502, { mensaje: 'caído' }), campos)).toBeNull();
        expect(erroresDelServidor(errorHttp(400, { mensaje: 'viejo' }), campos)).toBeNull();
        expect(erroresDelServidor(new Error('Network Error'), campos)).toBeNull();
    });
});
