import { errorDeDocumento, validarAlta, validarFormularioContrato } from './reglas';

const form = {
    id_inmueble: 'i-1', documento: '1020304050', inicio: '2026-01-01', fin: '2027-01-01', canon: '1500000',
    fecha_limite_pago: '1', fecha_inicio_corte: '', info_contrato: '',
    nombre_deudor_solidario: '', documento_deudor_solidario: ''
};
const inquilino = { id: 'u-1', nombre: 'Ana Ruiz' };
const campos = (errores) => errores.map((error) => error.campo);

describe('validarFormularioContrato', () => {
    test('un formulario completo no da errores', () => {
        expect(validarFormularioContrato(form, inquilino)).toEqual([]);
    });

    test('INC-004: el deudor de un incidente da error en sus dos campos', () => {
        const errores = validarFormularioContrato(
            { ...form, nombre_deudor_solidario: '12-31', documento_deudor_solidario: 'adada' }, inquilino
        );
        expect(campos(errores)).toEqual(['nombre_deudor_solidario', 'documento_deudor_solidario']);
    });

    test('deudor incompleto: el error va en el campo que falta', () => {
        expect(campos(validarFormularioContrato({ ...form, nombre_deudor_solidario: 'Ana Fiadora' }, inquilino)))
            .toEqual(['documento_deudor_solidario']);
    });

    test('sin inmueble ni inquilino, los pasos del flujo van primero', () => {
        expect(campos(validarFormularioContrato({ ...form, id_inmueble: '' }, null))).toEqual(['id_inmueble', 'documento']);
    });
});

describe('documento del inquilino', () => {
    test('INC-003: letras en el documento dan error antes de buscar', () => {
        expect(errorDeDocumento('dasnsjdoasjdoaj')).toEqual(expect.any(String));
        expect(errorDeDocumento('1020304050')).toBeUndefined();
    });
});

describe('validarAlta', () => {
    test('INC-003: nombres y celular basura', () => {
        const alta = { nombres: '1468498', apellidos: 'Ruiz', email: 'ana@correo.com', telefono: '97wqqewqeqeq', documento: '1020304050' };
        expect(campos(validarAlta(alta))).toEqual(['nombres', 'telefono']);
    });
});
