/**
 * Ajuste del canon: la alerta al propietario cuando se abre la ventana, y el aviso formal al
 * inquilino cuando se aplica.
 */

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

describe('AjusteCanonProximo', () => {
  test('el propietario recibe la alerta con el canon sugerido y la fecha de ajuste', async () => {
    const idPropietario = usuarioDe({ email: 'duena@ajuste.test', nombres: 'Ana' });

    const { respuesta, sobre } = await entregarEvento('AjusteCanonProximo', {
      id_contrato: crypto.randomUUID(),
      id_propietario: idPropietario,
      direccion_inmueble: 'Calle 63 # 9-45',
      canon_actual: 1500000,
      canon_sugerido: 1578000,
      ipc: 5.2,
      anio_ipc: 2024,
      fecha_ajuste: '2025-03-10',
    });

    expect(respuesta.status).toBe(200);
    const envios = await enviosDe(sobre.id_evento);
    expect(envios).toHaveLength(1);
    expect(envios[0]?.destinatario).toBe('duena@ajuste.test');
    expect(envios[0]?.asunto).toContain('Calle 63 # 9-45');
    expect(envios[0]?.cuerpo).toContain('$ 1.578.000');
    expect(envios[0]?.cuerpo).toContain('5,20 %');
    expect(envios[0]?.cuerpo).toContain('10 de marzo de 2025');
  });
});

describe('CanonAjustado', () => {
  const canonAjustado = (idInquilino: string, idPropietario: string) => ({
    id_contrato: crypto.randomUUID(),
    id_inquilino: idInquilino,
    id_propietario: idPropietario,
    direccion_inmueble: 'Calle 63 # 9-45',
    canon_anterior: 1500000,
    canon_nuevo: 1578000,
    ipc: 5.2,
    anio_ipc: 2024,
    rige_desde: '2025-03-10',
  });

  test('el inquilino recibe el aviso formal, con el nombre del propietario', async () => {
    const idInquilino = usuarioDe({ email: 'inquilino@ajuste.test', nombres: 'Bruno' });
    const idPropietario = usuarioDe({ email: 'dueno@ajuste.test', nombres: 'Carmen' });

    const { sobre } = await entregarEvento('CanonAjustado', canonAjustado(idInquilino, idPropietario));

    const envios = await enviosDe(sobre.id_evento);
    expect(envios).toHaveLength(1);
    expect(envios[0]?.destinatario).toBe('inquilino@ajuste.test');
    const cuerpo = envios[0]?.cuerpo ?? '';
    expect(cuerpo).toContain('Carmen');
    expect(cuerpo).toContain('artículo 20 de la Ley 820 de 2003');
    expect(cuerpo).toContain('$ 1.500.000');
    expect(cuerpo).toContain('$ 1.578.000');
    expect(cuerpo).toContain('5,20 %');
    expect(cuerpo).toContain('10 de marzo de 2025');
  });

  test('un evento repetido no envía un segundo correo', async () => {
    const idInquilino = usuarioDe({ email: 'repetido@ajuste.test' });
    const idPropietario = usuarioDe();

    const primera = await entregarEvento('CanonAjustado', canonAjustado(idInquilino, idPropietario));
    await entregarEvento('CanonAjustado', primera.sobre.payload, primera.sobre);

    expect(await enviosDe(primera.sobre.id_evento)).toHaveLength(1);
  });
});
