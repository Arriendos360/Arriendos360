import { validarFormularioInmueble } from './reglas';

const form = {
    alias: 'Apto Chicó', direccion: 'Calle 100 # 15-20', tipo: 'apartamento', departamento: '', ciudad: '', barrio: '',
    descripcion: '', area_m2: '', habitaciones: '', banos: '', parqueaderos: '', deposito: '', estrato: ''
};
const campos = (errores) => errores.map((error) => error.campo);

describe('validarFormularioInmueble', () => {
    test('el formulario vacío salvo lo obligatorio es válido', () => {
        expect(validarFormularioInmueble(form)).toEqual([]);
    });

    test('el área con coma decimal se acepta', () => {
        expect(validarFormularioInmueble({ ...form, area_m2: '78,5', estrato: '4', habitaciones: '3' })).toEqual([]);
    });

    test('estrato 9, área "0" y barrio de 101, en el orden de la pantalla', () => {
        expect(campos(validarFormularioInmueble({ ...form, estrato: '9', area_m2: '0', barrio: 'b'.repeat(101) })))
            .toEqual(['barrio', 'area_m2', 'estrato']);
    });

    test('conteos negativos o fraccionarios', () => {
        expect(campos(validarFormularioInmueble({ ...form, banos: '-1', parqueaderos: '1.5' }))).toEqual(['banos', 'parqueaderos']);
    });
});
