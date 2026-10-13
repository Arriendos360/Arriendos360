import { IPC_ANUAL } from '../src/contratos';

describe('IPC_ANUAL', () => {
  test.each(Object.entries(IPC_ANUAL))('%s: positivo y con dos decimales como mucho', (_anio, ipc) => {
    expect(ipc).toBeGreaterThan(0);
    expect(Math.round(ipc * 100) / 100).toBe(ipc);
  });

  test('2025 según el DANE', () => {
    expect(IPC_ANUAL[2025]).toBe(5.1);
  });
});
