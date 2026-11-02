/** El resumen de las cuentas ya vencidas al registrar un contrato: un solo correo, al inquilino. */

import crypto from 'crypto';

import {
  cerrarEntorno,
  entregarEvento,
  enviosDe,
  prepararEntorno,
  usuarioDe,
} from './utiles/entorno';

beforeAll(async () => {
  await prepararEntorno();
});

afterAll(async () => {
  await cerrarEntorno();
});

const carga = (idInquilino: string) => ({
  id_contrato: crypto.randomUUID(),
  id_inquilino: idInquilino,
  cantidad: 3,
  total: 4500000,
  primer_periodo: '2026-08-17',
  ultimo_periodo: '2026-11-16',
});

describe('CuentasAtrasadasRegistradas', () => {
  test('escribe un solo correo, al inquilino, con el total y el rango', async () => {
    const { respuesta, sobre } = await entregarEvento(
      'CuentasAtrasadasRegistradas',
      carga(usuarioDe({ email: 'inquilino@atrasadas.test' })),
    );

    expect(respuesta.status).toBe(200);
    const envios = await enviosDe(sobre.id_evento);
    expect(envios.map((envio) => envio.destinatario)).toEqual(['inquilino@atrasadas.test']);
    expect(envios[0]?.cuerpo).toContain('4.500.000');
    expect(envios[0]?.cuerpo).toContain('17 de agosto de 2026');
    expect(envios[0]?.cuerpo).toContain('16 de noviembre de 2026');
  });

  test('un sobre repetido no duplica el correo', async () => {
    const primera = await entregarEvento('CuentasAtrasadasRegistradas', carga(usuarioDe()));
    await entregarEvento('CuentasAtrasadasRegistradas', primera.sobre.payload, primera.sobre);

    expect(await enviosDe(primera.sobre.id_evento)).toHaveLength(1);
  });

  test('una carga sin rango se rechaza', async () => {
    const { primer_periodo: _sinRango, ...sinRango } = carga(usuarioDe());

    const { respuesta, sobre } = await entregarEvento('CuentasAtrasadasRegistradas', sinRango as never);

    expect(respuesta.status).toBe(500);
    expect(await enviosDe(sobre.id_evento)).toHaveLength(0);
  });
});
