import { conReintentos, mensajeDeLogin, validarContrasenaNueva } from './reglas';

const errorHttp = (status, data) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const sinRespuesta = () => new Error('Network Error');
const sinEspera = { esperas: [1, 2, 3], esperar: () => Promise.resolve() };

describe('conReintentos', () => {
    test('reintenta mientras el servicio despierta y devuelve la respuesta', async () => {
        const fallos = [errorHttp(502), sinRespuesta(), errorHttp(503)];
        const reintentos = [];
        const peticion = jest.fn(async () => {
            if (fallos.length) throw fallos.shift();
            return 'ok';
        });

        await expect(conReintentos(peticion, { ...sinEspera, alReintentar: (i) => reintentos.push(i) })).resolves.toBe('ok');
        expect(peticion).toHaveBeenCalledTimes(4);
        expect(reintentos).toEqual([0, 1, 2]);
    });

    test('no reintenta un error de credenciales', async () => {
        const peticion = jest.fn().mockRejectedValue(errorHttp(401));
        await expect(conReintentos(peticion, sinEspera)).rejects.toMatchObject({ response: { status: 401 } });
        expect(peticion).toHaveBeenCalledTimes(1);
    });

    test('se rinde tras agotar las esperas', async () => {
        const peticion = jest.fn().mockRejectedValue(errorHttp(504));
        await expect(conReintentos(peticion, sinEspera)).rejects.toMatchObject({ response: { status: 504 } });
        expect(peticion).toHaveBeenCalledTimes(4);
    });
});

describe('mensajeDeLogin', () => {
    test('el 401 habla de credenciales', () => {
        expect(mensajeDeLogin(errorHttp(401, {}))).toBe('Correo o contraseña incorrectos.');
    });

    test('el 429 conserva el mensaje del servicio', () => {
        expect(mensajeDeLogin(errorHttp(429, { mensaje: 'Demasiados intentos' }))).toBe('Demasiados intentos');
    });

    test('sin respuesta no culpa a las credenciales', () => {
        expect(mensajeDeLogin(sinRespuesta())).toMatch(/no respondió/);
    });
});

describe('validarContrasenaNueva', () => {
    test('exige el mínimo del servicio', () => {
        expect(validarContrasenaNueva({ nueva: 'corta', confirmar: 'corta' })).toMatch(/8 caracteres/);
    });

    test('exige que coincidan', () => {
        expect(validarContrasenaNueva({ nueva: 'larga1234', confirmar: 'larga12345' })).toMatch(/no coinciden/);
    });

    test('al cambiarla, exige que sea distinta de la actual', () => {
        expect(validarContrasenaNueva({ nueva: 'misma1234', confirmar: 'misma1234', actual: 'misma1234' })).toMatch(/distinta/);
    });

    test('una válida pasa', () => {
        expect(validarContrasenaNueva({ nueva: 'nueva1234', confirmar: 'nueva1234', actual: 'vieja1234' })).toBeNull();
    });
});
