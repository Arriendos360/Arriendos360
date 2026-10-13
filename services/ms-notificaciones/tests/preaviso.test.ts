/**
 * Preaviso de terminación: el recordatorio a las dos partes y el aviso formal a la otra parte
 * cuando una lo envía.
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

const partes = (idInquilino: string, idPropietario: string) => ({
  id_contrato: crypto.randomUUID(),
  id_inquilino: idInquilino,
  id_propietario: idPropietario,
  direccion_inmueble: 'Calle 63 # 9-45',
  vencimiento: '2026-12-31',
});

describe('PreavisoProximo', () => {
  test('escribe a las dos partes', async () => {
    const idInquilino = usuarioDe({ email: 'inquilino@preaviso.test' });
    const idPropietario = usuarioDe({ email: 'duena@preaviso.test' });

    const { respuesta, sobre } = await entregarEvento('PreavisoProximo', {
      ...partes(idInquilino, idPropietario),
      fecha_limite: '2026-09-30',
    });

    expect(respuesta.status).toBe(200);
    const envios = await enviosDe(sobre.id_evento);
    expect(envios.map((envio) => envio.destinatario).sort()).toEqual(['duena@preaviso.test', 'inquilino@preaviso.test']);
    expect(envios[0]?.cuerpo).toContain('30 de septiembre de 2026');
  });

  test('un sobre repetido no duplica los envíos', async () => {
    const carga = { ...partes(usuarioDe(), usuarioDe()), fecha_limite: '2026-09-30' };

    const primera = await entregarEvento('PreavisoProximo', carga);
    await entregarEvento('PreavisoProximo', primera.sobre.payload, primera.sobre);

    expect(await enviosDe(primera.sobre.id_evento)).toHaveLength(2);
  });

  test('una carga sin id_contrato se rechaza', async () => {
    const { id_contrato: _sinContrato, ...sinContrato } = partes(usuarioDe(), usuarioDe());

    const { respuesta, sobre } = await entregarEvento('PreavisoProximo', {
      ...sinContrato,
      fecha_limite: '2026-09-30',
    } as never);

    expect(respuesta.status).not.toBe(200);
    expect(await enviosDe(sobre.id_evento)).toHaveLength(0);
  });
});

describe('PreavisoEnviado', () => {
  const enviado = (
    idInquilino: string,
    idPropietario: string,
    parte: 'PROPIETARIO' | 'INQUILINO',
    causal: string | null,
  ) => ({
    ...partes(idInquilino, idPropietario),
    parte,
    causal,
    enviado_en: '2026-09-05T15:00:00.000Z',
  });

  test('si avisa el inquilino, escribe sólo al propietario', async () => {
    const idInquilino = usuarioDe({ email: 'avisa@preaviso.test', nombres: 'Bruno' });
    const idPropietario = usuarioDe({ email: 'recibe@preaviso.test' });

    const { sobre } = await entregarEvento('PreavisoEnviado', enviado(idInquilino, idPropietario, 'INQUILINO', null));

    const envios = await enviosDe(sobre.id_evento);
    expect(envios).toHaveLength(1);
    expect(envios[0]?.destinatario).toBe('recibe@preaviso.test');
    expect(envios[0]?.cuerpo).toContain('Bruno');
    expect(envios[0]?.cuerpo).toContain('artículo 24');
  });

  test('si avisa el propietario, escribe sólo al inquilino con la causal', async () => {
    const idInquilino = usuarioDe({ email: 'inquilino2@preaviso.test' });
    const idPropietario = usuarioDe({ email: 'propietaria2@preaviso.test', nombres: 'Carmen' });

    const { sobre } = await entregarEvento(
      'PreavisoEnviado',
      enviado(idInquilino, idPropietario, 'PROPIETARIO', 'compraventa'),
    );

    const envios = await enviosDe(sobre.id_evento);
    expect(envios).toHaveLength(1);
    expect(envios[0]?.destinatario).toBe('inquilino2@preaviso.test');
    expect(envios[0]?.cuerpo).toContain('Carmen');
    expect(envios[0]?.cuerpo).toContain('artículo 22');
    expect(envios[0]?.cuerpo).toContain('compraventa');
  });

  test('un sobre repetido no duplica el envío', async () => {
    const primera = await entregarEvento('PreavisoEnviado', enviado(usuarioDe(), usuarioDe(), 'INQUILINO', null));
    await entregarEvento('PreavisoEnviado', primera.sobre.payload, primera.sobre);

    expect(await enviosDe(primera.sobre.id_evento)).toHaveLength(1);
  });

  test.each([
    ['sin id_contrato', { id_contrato: undefined }],
    ['del propietario sin causal', { parte: 'PROPIETARIO', causal: null }],
  ])('una carga %s se rechaza', async (_caso, cambios) => {
    const { respuesta, sobre } = await entregarEvento('PreavisoEnviado', {
      ...enviado(usuarioDe(), usuarioDe(), 'INQUILINO', null),
      ...cambios,
    } as never);

    expect(respuesta.status).not.toBe(200);
    expect(await enviosDe(sobre.id_evento)).toHaveLength(0);
  });
});
