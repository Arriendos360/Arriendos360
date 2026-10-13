import { resumenDePreaviso } from './preaviso';

const preaviso = {
    vencimiento: '2026-12-31', fecha_limite: '2026-09-30', recordatorio_desde: '2026-08-31',
    en_ventana: true, dentro_de_plazo: true, prorrogado: false, vencido: false, enviado: null
};

describe('resumenDePreaviso', () => {
    test('sin preaviso no hay nada que mostrar', () => {
        expect(resumenDePreaviso(undefined)).toBeNull();
    });

    test('con la ventana abierta destaca la fecha límite y deja enviar', () => {
        const resumen = resumenDePreaviso(preaviso);
        expect(resumen).toMatchObject({ vencimiento: '31 dic 2026', limite: '30 sep 2026', destacarLimite: true, puedeEnviar: true });
        expect(resumen.estado).toContain('a más tardar el 30 sep 2026');
    });

    test('dentro de plazo pero antes de la ventana deja enviar sin destacar', () => {
        expect(resumenDePreaviso({ ...preaviso, en_ventana: false })).toMatchObject({ destacarLimite: false, puedeEnviar: true });
    });

    test('fuera de plazo no deja enviar y avisa de la prórroga', () => {
        const resumen = resumenDePreaviso({ ...preaviso, en_ventana: false, dentro_de_plazo: false });
        expect(resumen.puedeEnviar).toBe(false);
        expect(resumen.estado).toContain('se prorroga');
    });

    test.each([
        ['INQUILINO', 'el arrendatario'],
        ['PROPIETARIO', 'el arrendador']
    ])('enviado por %s: dice quién y no deja reenviar', (parte, quien) => {
        const resumen = resumenDePreaviso({ ...preaviso, enviado: { parte, enviado_en: '2026-09-05T20:00:00.000Z', causal: null } });
        expect(resumen).toMatchObject({ enviado: true, puedeEnviar: false, destacarLimite: false });
        expect(resumen.estado).toBe(`Preaviso enviado por ${quien} el 5 sep 2026, 15:00.`);
    });

    test('vencido con preaviso invita a finalizar', () => {
        const enviado = { parte: 'INQUILINO', enviado_en: '2026-09-05T20:00:00.000Z', causal: null };
        const resumen = resumenDePreaviso({ ...preaviso, en_ventana: false, dentro_de_plazo: false, vencido: true, enviado });
        expect(resumen.estado).toContain('falta finalizar');
    });

    test('las causales del propietario llevan su etiqueta legal', () => {
        const resumen = resumenDePreaviso({ ...preaviso, causales_disponibles: ['ocupacion_propia'] });
        expect(resumen.causales).toEqual([{ valor: 'ocupacion_propia', texto: expect.stringContaining('propia habitación') }]);
        expect(resumenDePreaviso(preaviso).causales).toEqual([]);
    });
});
