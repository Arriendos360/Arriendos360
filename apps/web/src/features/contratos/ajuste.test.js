import { resumenDeAjuste } from './ajuste';

const ajuste = {
    fecha_ajuste: '2025-03-10', ventana_desde: '2025-02-10', en_ventana: true,
    anio_ipc: 2024, ipc: 5.2, canon_sugerido: 1578000, rige_desde: '2025-03-10'
};

describe('resumenDeAjuste', () => {
    test('sin ajuste_canon no hay nada que mostrar', () => {
        expect(resumenDeAjuste(undefined)).toBeNull();
    });

    test('con la ventana abierta se puede aplicar', () => {
        expect(resumenDeAjuste(ajuste)).toMatchObject({ ipc: '5,20 % (2024)', sugerido: 1578000, puedeAplicar: true });
        expect(resumenDeAjuste(ajuste).fecha).toMatch(/10 .* 2025/);
    });

    test('antes de la ventana dice desde cuándo', () => {
        const resumen = resumenDeAjuste({ ...ajuste, en_ventana: false });
        expect(resumen.puedeAplicar).toBe(false);
        expect(resumen.estado).toMatch(/Podrás aplicarlo desde el 10 .* 2025/);
    });

    test('sin IPC del año avisa que falta y no deja aplicar', () => {
        const resumen = resumenDeAjuste({ ...ajuste, ipc: null, canon_sugerido: null, en_ventana: false, anio_ipc: 2026 });
        expect(resumen).toMatchObject({ ipc: null, puedeAplicar: false });
        expect(resumen.estado).toContain('Falta el IPC de 2026');
    });
});
