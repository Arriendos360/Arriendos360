/**
 * Lo que estas pruebas cuidan son los cuerpos: que cada capa hable con los
 * nombres y tipos del Capítulo 2. El cliente HTTP se sustituye entero —la red y
 * la seguridad de `services/api.js` no son de esta capa—.
 */

import { actualizarInmueble, crearInmueble, eliminarInmueble } from './inmuebles/api';
import { actualizarContrato, crearContrato, fechaDeContrato, subirAnexo } from './contratos/api';
import { anularTransaccion, crearCuentaCobro, registrarPago } from './pagos/api';
import { buscarPorDocumento, crearInquilino } from './usuarios/api';
import { montoParaEnviar, soloCampos } from './comun';
import api from '../services/api';

jest.mock('../services/api', () => ({
    __esModule: true,
    default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }
}));

jest.mock('../services/descargas', () => ({ abrirPdf: jest.fn(), descargarPdf: jest.fn() }));

beforeEach(() => {
    jest.clearAllMocks();
    for (const metodo of ['get', 'post', 'put', 'delete']) api[metodo].mockResolvedValue({ data: { ok: true } });
});

describe('comun', () => {
    test('montoParaEnviar convierte el texto decimal justo al enviar', () => {
        expect(montoParaEnviar('1500000.5')).toBe(1500000.5);
        expect(montoParaEnviar('1500000')).toBe(1500000);
        expect(montoParaEnviar('')).toBeUndefined();
        expect(montoParaEnviar('abc')).toBeUndefined();
    });

    test('soloCampos recorta, quita vacíos y lo que no está en la lista', () => {
        expect(soloCampos({ a: ' x ', b: '', c: null, d: 0, e: 'fuera' }, ['a', 'b', 'c', 'd'])).toEqual({ a: 'x', d: 0 });
    });
});

test('devuelve el cuerpo, no la respuesta de axios', async () => {
    await expect(eliminarInmueble('i1')).resolves.toEqual({ ok: true });
});

test('inmuebles manda sólo las columnas del endpoint, con los enteros como número', async () => {
    await crearInmueble({
        alias: 'Apto 301', direccion: 'Calle 10 # 45-20', municipio: 'Bogotá D.C.', tipo: 'apartamento',
        barrio: '', area_m2: '78.5', habitaciones: '3', id_propietario: 'otro', estado: 'arrendado'
    });

    expect(api.post).toHaveBeenCalledWith('/inmuebles', {
        direccion: 'Calle 10 # 45-20', tipo: 'apartamento', municipio: 'Bogotá D.C.', area_m2: '78.5', habitaciones: 3
    });
});

test('al editar, un opcional vaciado viaja null y un obligatorio vacío no viaja', async () => {
    await actualizarInmueble('i1', { direccion: '', tipo: 'casa', barrio: ' ', estrato: '' });

    expect(api.put).toHaveBeenCalledWith('/inmuebles/i1', { tipo: 'casa', barrio: null, estrato: null });
});

test('el contrato va en JSON, con el día límite entero y el canon numérico', async () => {
    await crearContrato({
        id_inmueble: 'i1', id_inquilino: 'u1', inicio: '2026-10-01', fin: '2027-09-30',
        fecha_inicio_corte: '2026-10-01', fecha_limite_pago: '5', canon: '1500000',
        nombre_deudor_solidario: '', documento_deudor_solidario: ''
    });

    const [ruta, enviado] = api.post.mock.calls[0];
    expect(ruta).toBe('/contratos');
    expect(enviado).not.toBeInstanceOf(FormData);
    expect(enviado).toEqual({
        id_inmueble: 'i1', id_inquilino: 'u1', inicio: '2026-10-01', fin: '2027-09-30',
        fecha_inicio_corte: '2026-10-01', fecha_limite_pago: 5, canon: 1500000
    });
});

test('sin día límite, no se manda: lo deriva el servicio', async () => {
    await crearContrato({ id_inmueble: 'i1', id_inquilino: 'u1', inicio: '2026-10-01', fin: '2027-09-30', canon: '1', fecha_limite_pago: '' });
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('fecha_limite_pago');
});

test('editar un contrato no manda sus partes ni su estado, y vaciar un opcional lo borra', async () => {
    await actualizarContrato('c1', {
        id_inquilino: 'u2', estado: 'cancelado', inicio: '2020-01-01',
        fin: '2028-01-31', canon: '1600000', fecha_limite_pago: '10',
        info_contrato: 'Incluye parqueadero', nombre_deudor_solidario: '', documento_deudor_solidario: ' '
    });

    expect(api.put).toHaveBeenCalledWith('/contratos/c1', {
        fin: '2028-01-31', canon: 1600000, fecha_limite_pago: 10, info_contrato: 'Incluye parqueadero',
        nombre_deudor_solidario: null, documento_deudor_solidario: null
    });
});

test('inicio y fin vuelven como instante UTC y se leen como el día guardado', () => {
    expect(fechaDeContrato('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
    expect(fechaDeContrato('2026-10-01')).toBe('2026-10-01');
    expect(fechaDeContrato(null)).toBeNull();
    expect(fechaDeContrato('mañana')).toBeNull();
});

test('el anexo va en multipart con `file` y `tipo`', async () => {
    const archivo = new File(['%PDF-1.4'], 'firmado.pdf', { type: 'application/pdf' });
    await subirAnexo('c1', { archivo, tipo: ' OTROSI ' });

    const [ruta, formulario] = api.post.mock.calls[0];
    expect(ruta).toBe('/contratos/c1/anexos');
    expect(formulario.get('file')).toBeInstanceOf(File);
    expect(formulario.get('tipo')).toBe('OTROSI');
});

test('un pago lleva tipo INGRESO aparte del medio de pago', async () => {
    await registrarPago({ id_cuenta_cobro: 'cc1', monto: '750000', medio_pago: 'TRANSFERENCIA', observaciones: 'Ref 123', tipo: 'EGRESO' });

    expect(api.post).toHaveBeenCalledWith('/pagos', {
        id_cuenta_cobro: 'cc1', medio_pago: 'TRANSFERENCIA', observaciones: 'Ref 123', tipo: 'INGRESO', monto: 750000
    });
});

test('un día de pago viaja como mediodía de Bogotá, no como medianoche UTC', async () => {
    await registrarPago({ id_cuenta_cobro: 'cc1', monto: '1', fecha_pago: '2026-09-01' });
    expect(api.post.mock.calls[0][1].fecha_pago).toBe('2026-09-01T17:00:00Z');
});

test('el cobro manual manda el valor como número', async () => {
    await crearCuentaCobro({ id_contrato: 'c1', valor: '1500000', detalle: 'Canon octubre' });
    expect(api.post).toHaveBeenCalledWith('/pagos/cuentas-cobro', { id_contrato: 'c1', detalle: 'Canon octubre', valor: 1500000 });
});

test('anular no manda cuerpo', async () => {
    await anularTransaccion('t1');
    expect(api.post).toHaveBeenCalledWith('/pagos/transacciones/t1/anular');
});

describe('usuarios', () => {
    test('un documento sin dueño es null, no un error', async () => {
        api.get.mockRejectedValueOnce({ response: { status: 404 } });
        await expect(buscarPorDocumento('123')).resolves.toBeNull();
    });

    test('otros errores suben', async () => {
        api.get.mockRejectedValueOnce({ response: { status: 502 } });
        await expect(buscarPorDocumento('123')).rejects.toEqual({ response: { status: 502 } });
    });

    test('el alta de inquilino no manda contraseña', async () => {
        await crearInquilino({ nombres: 'Ana', apellidos: 'Ruiz', email: 'a@b.co', documento: '1', contrasena: 'x' });
        expect(api.post.mock.calls[0][1]).not.toHaveProperty('contrasena');
    });
});
