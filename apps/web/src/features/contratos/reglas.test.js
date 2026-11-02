import {
    antiguedadDelContrato, avisoDeCuentas, errorDeDocumento, validarAlta, validarFormularioContrato as validar
} from './reglas';

const HOY = '2026-01-01';
const validarFormularioContrato = (form, inquilino, hoy = HOY) => validar(form, inquilino, hoy);

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

describe('un contrato que ya corría', () => {
    const hoy = '2026-11-02';
    const antiguo = {
        ...form, inicio: '2020-02-17', fin: '2021-02-17', fecha_limite_pago: '17',
        ultimo_periodo_pagado: '', fecha_ultimo_ajuste: '', nunca_ajustado: false
    };
    const errores = (cambio, dia = hoy) => campos(validarFormularioContrato({ ...antiguo, ...cambio }, inquilino, dia));

    test('pide el último mes y el ajuste, con el periodo real de cada mes', () => {
        const { pideMes, pideAjuste, meses, pendientes } = antiguedadDelContrato(antiguo, hoy);
        expect([pideMes, pideAjuste, pendientes]).toEqual([true, true, null]);
        expect(meses[0]).toEqual({ valor: '2026-11', texto: '17 nov 2026 – 16 dic 2026' });
        expect(meses.at(-1)).toEqual({ valor: '2020-02', texto: '17 feb 2020 – 16 mar 2020' });
    });

    test('con el primer corte hoy, futuro, anterior al inicio o sin fecha no pide el mes', () => {
        const nada = { pideMes: false, pideAjuste: false, meses: [], pendientes: null };
        expect(antiguedadDelContrato({ ...form, inicio: hoy }, hoy)).toEqual(nada);
        expect(antiguedadDelContrato({ ...form, inicio: '2026-12-01' }, hoy)).toEqual(nada);
        expect(antiguedadDelContrato({ ...form, inicio: '2026-10-02', fecha_inicio_corte: '2026-12-01' }, hoy)).toEqual(nada);
        expect(antiguedadDelContrato({ ...form, inicio: '2026-10-02', fecha_inicio_corte: '2026-10-01' }, hoy)).toEqual(nada);
        expect(antiguedadDelContrato({ ...form, inicio: '' }, hoy)).toEqual(nada);
    });

    test('un contrato de días ya pregunta el mes', () => {
        expect(antiguedadDelContrato({ ...form, inicio: '2026-10-30' }, hoy).pideMes).toBe(true);
    });

    test('con menos de 12 meses pide el mes y no el ajuste', () => {
        const { pideMes, pideAjuste } = antiguedadDelContrato({ ...form, inicio: '2026-05-20' }, hoy);
        expect([pideMes, pideAjuste]).toEqual([true, false]);
    });

    test('anuncia las cuentas que creará el mes elegido, sólo si es válido', () => {
        const pendientes = (ultimo_periodo_pagado) => antiguedadDelContrato({ ...antiguo, ultimo_periodo_pagado }, hoy).pendientes;
        expect(pendientes('2026-08')).toHaveLength(2);
        expect(pendientes('2026-11')).toEqual([]);
        expect(pendientes('2019-01')).toBeNull();
        expect(pendientes('2025-13')).toBeNull();
    });

    test('«no ha pagado ningún mes» anuncia todas, desde el primer periodo', () => {
        const { pendientes } = antiguedadDelContrato({ ...form, inicio: '2026-08-17', nunca_pagado: true }, hoy);
        expect(pendientes.map(({ inicio }) => inicio)).toEqual(['2026-08-17', '2026-09-17', '2026-10-17']);
    });

    test('el aviso da el rango, el número de cuentas y el total', () => {
        const dos = [{ inicio: '2026-09-17', fin: '2026-10-16' }, { inicio: '2026-10-17', fin: '2026-11-16' }];
        expect(avisoDeCuentas([], '1500000')).toBe('No se creará ninguna cuenta: el contrato está al día.');
        expect(avisoDeCuentas(dos, '1500000.5')).toBe(
            'Se crearán 2 cuentas pendientes, del 17 sep 2026 al 16 nov 2026, por $ 3.000.001 en total. Revísalo antes de firmar: no se puede anular desde la aplicación.'
        );
        expect(avisoDeCuentas(dos.slice(0, 1), null)).toBe(
            'Se creará 1 cuenta pendiente, del 17 sep 2026 al 16 oct 2026. Revísalo antes de firmar: no se puede anular desde la aplicación.'
        );
    });

    test('faltan el mes y el ajuste: los dos errores, y la casilla quita el segundo', () => {
        expect(errores({})).toEqual(['ultimo_periodo_pagado', 'fecha_ultimo_ajuste']);
        expect(errores({ nunca_ajustado: true })).toEqual(['ultimo_periodo_pagado']);
        expect(errores({ ultimo_periodo_pagado: '2026-08', fecha_ultimo_ajuste: '2026-02-17' })).toEqual([]);
    });

    test('la casilla de «ningún mes» reemplaza al mes', () => {
        expect(errores({ nunca_pagado: true, nunca_ajustado: true })).toEqual([]);
    });

    test('fuera de rango da error', () => {
        expect(errores({ ultimo_periodo_pagado: '2020-01', nunca_ajustado: true })).toEqual(['ultimo_periodo_pagado']);
        expect(errores({ ultimo_periodo_pagado: '2026-08', fecha_ultimo_ajuste: '2026-11-03' })).toEqual(['fecha_ultimo_ajuste']);
    });
});
