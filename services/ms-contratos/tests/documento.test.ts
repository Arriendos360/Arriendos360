import crypto from 'crypto';
import request from 'supertest';

import { documentoContrato, type DatosContrato } from '../src/services/documentoContrato';
import {
  app,
  cerrarEntorno,
  conToken,
  crearContrato,
  firmarToken,
  identidadFalsa,
  inmuebleDe,
  inmueblesFalso,
  inquilinoDe,
  prepararEntorno,
  propietario,
} from './utiles/entorno';
import { textoDelPdf } from './utiles/pdf';

/**
 * El documento del contrato (RF-24): la plantilla con datos fijos y el endpoint
 * por HTTP contra los dobles.
 */

/** Espacios normalizados: el `$` lleva un espacio duro y las líneas se parten donde caen. */
const texto = (pdf: Buffer): string => textoDelPdf(pdf).replace(/\s+/g, ' ');

const generar = (datos: DatosContrato): Promise<Buffer> =>
  new Promise((resolver, rechazar) => {
    const trozos: Buffer[] = [];
    documentoContrato(datos)
      .on('data', (trozo: Buffer) => trozos.push(trozo))
      .on('end', () => resolver(Buffer.concat(trozos)))
      .on('error', rechazar);
  });

const datos = (
  contrato: Partial<DatosContrato['contrato']> = {},
  inmueble: Record<string, unknown> = {},
): DatosContrato => ({
  contrato: {
    id_contrato: crypto.randomUUID(),
    inicio: '2026-01-01',
    fin: '2026-12-31',
    canon: 1500000,
    fecha_inicio_corte: '2026-01-01',
    fecha_limite_pago: 5,
    info_contrato: null,
    nombre_deudor_solidario: null,
    documento_deudor_solidario: null,
    ...contrato,
  },
  inmueble: {
    id_inmueble: crypto.randomUUID(),
    id_propietario: crypto.randomUUID(),
    direccion: 'Calle 123 #45-67',
    ciudad: 'Bogotá D.C.',
    tipo: 'apartamento',
    ...inmueble,
  },
  arrendador: { nombres: 'Ana', apellidos: 'Propietaria', documento: '1020304050' },
  arrendatario: { nombres: 'Luis', apellidos: 'Arrendatario', documento: '9080706050' },
});

let duenio: ReturnType<typeof propietario>;
let arrendatario: ReturnType<typeof propietario>;
let idContrato: string;

beforeAll(async () => {
  await prepararEntorno();

  duenio = propietario();
  identidadFalsa().usuarios.set(duenio.sub, {
    id: duenio.sub,
    nombres: 'Ana',
    apellidos: 'Propietaria',
    documento: '1020304050',
    roles: ['PROPIETARIO'],
  });

  const idInquilino = inquilinoDe('Luis', 'Arrendatario');
  arrendatario = firmarToken({ sub: idInquilino, roles: ['INQUILINO'] });

  idContrato = (await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino)).id;
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('La plantilla', () => {
  test('imprime las partes, el inmueble, el canon, el día de pago y la vigencia', async () => {
    const lectura = texto(await generar(datos()));

    expect(lectura).toContain('CONTRATO DE ARRENDAMIENTO DE VIVIENDA URBANA');
    expect(lectura).toContain('Ana Propietaria');
    expect(lectura).toContain('1020304050');
    expect(lectura).toContain('Luis Arrendatario');
    expect(lectura).toContain('9080706050');
    expect(lectura).toContain('Calle 123 #45-67');
    expect(lectura).toContain('$ 1.500.000');
    expect(lectura).toContain('el día 5 de cada mes');
    expect(lectura).toContain('1 de enero de 2026');
    expect(lectura).toContain('31 de diciembre de 2026');
  });

  test('trae el incremento con tope del IPC y el preaviso de tres meses', async () => {
    const lectura = texto(await generar(datos()));

    expect(lectura).toContain('índice de precios al consumidor (IPC)');
    expect(lectura).toContain('artículo 20 de la Ley 820 de 2003');
    expect(lectura).toContain('preaviso');
    expect(lectura).toContain('tres (3) meses');
  });

  test('sin deudor ni condiciones no los menciona, y la numeración no salta', async () => {
    const lectura = texto(await generar(datos()));

    expect(lectura).not.toMatch(/deudor/i);
    expect(lectura).not.toContain('CONDICIONES PARTICULARES');
    expect(lectura).toContain('DÉCIMA. MÉRITO EJECUTIVO.');
  });

  test('con deudor solidario trae su cláusula y su firma', async () => {
    const lectura = texto(
      await generar(
        datos({ nombre_deudor_solidario: 'Rosa Fiadora', documento_deudor_solidario: '5551112223' }),
      ),
    );

    expect(lectura).toContain('DÉCIMA. DEUDOR SOLIDARIO.');
    expect(lectura).toContain('Rosa Fiadora, identificado con documento 5551112223');
    expect(lectura).toMatch(/Rosa Fiadora Documento 5551112223 DEUDOR SOLIDARIO/);
  });

  test('las condiciones particulares salen como cláusula', async () => {
    const lectura = texto(await generar(datos({ info_contrato: 'Incluye parqueadero' })));

    expect(lectura).toContain('DÉCIMA. CONDICIONES PARTICULARES. Incluye parqueadero');
    expect(lectura).toContain('UNDÉCIMA. MÉRITO EJECUTIVO.');
  });

  test('la ficha física imprime lo registrado y omite lo vacío', async () => {
    const lectura = texto(
      await generar(
        datos({}, { barrio: 'Chapinero', area_m2: '78.50', habitaciones: 3, banos: null, parqueaderos: 0, estrato: 4 }),
      ),
    );

    expect(lectura).toContain('Barrio: Chapinero');
    expect(lectura).toContain('Habitaciones: 3');
    expect(lectura).toContain('Parqueaderos: 0');
    expect(lectura).toContain('Estrato: 4');
    expect(lectura).not.toContain('Baños:');
    expect(lectura).toContain('Área: 78,5 m²');
  });
});

/** Pide el documento con el cuerpo como Buffer. */
const pedirDocumento = (id: string, token: string) =>
  request(app)
    .get(`/api/contratos/${id}/documento`)
    .set(...conToken(token))
    .buffer(true)
    .parse((res, callback) => {
      const trozos: Buffer[] = [];
      res.on('data', (trozo: Buffer) => trozos.push(trozo));
      res.on('end', () => callback(null, Buffer.concat(trozos)));
    });

describe('GET /api/contratos/:id/documento', () => {
  test('el propietario lo descarga como adjunto PDF', async () => {
    const respuesta = await pedirDocumento(idContrato, duenio.token);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.header['content-type']).toBe('application/pdf');
    expect(respuesta.header['content-disposition']).toMatch(/^attachment; filename="contrato-.{8}\.pdf"$/);
    expect(respuesta.header['x-content-type-options']).toBe('nosniff');
    expect((respuesta.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const lectura = texto(respuesta.body as Buffer);
    expect(lectura).toContain('Ana Propietaria');
    expect(lectura).toContain('Luis Arrendatario');
    expect(lectura).toContain('Calle 123 #45-67');
  });

  test('el inquilino también', async () => {
    const respuesta = await pedirDocumento(idContrato, arrendatario.token);

    expect(respuesta.statusCode).toBe(200);
    expect((respuesta.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  test('refleja el canon vigente', async () => {
    await request(app)
      .put(`/api/contratos/${idContrato}`)
      .set(...conToken(duenio.token))
      .send({ canon: 1400000 });

    const respuesta = await pedirDocumento(idContrato, duenio.token);

    expect(texto(respuesta.body as Buffer)).toContain('$ 1.400.000');
  });

  test('un ajeno, un id inexistente o mal formado reciben 404', async () => {
    const ajeno = await request(app)
      .get(`/api/contratos/${idContrato}/documento`)
      .set(...conToken(propietario().token));
    expect(ajeno.statusCode).toBe(404);
    expect(ajeno.body.mensaje).toBeDefined();

    for (const id of [crypto.randomUUID(), 'no-es-uuid']) {
      const respuesta = await request(app)
        .get(`/api/contratos/${id}/documento`)
        .set(...conToken(duenio.token));
      expect(respuesta.statusCode).toBe(404);
    }
  });

  test('sin token, 401', async () => {
    const respuesta = await request(app).get(`/api/contratos/${idContrato}/documento`);

    expect(respuesta.statusCode).toBe(401);
  });

  test('con ms-identidad caído, 502 y ningún PDF', async () => {
    identidadFalsa().caer();
    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}/documento`)
      .set(...conToken(duenio.token));
    identidadFalsa().levantar();

    expect(respuesta.statusCode).toBe(502);
    expect(respuesta.header['content-type']).toMatch(/json/);
    expect(respuesta.body.mensaje).toBeDefined();
  });

  test('con ms-inmuebles caído, 502 y ningún PDF', async () => {
    // El inquilino pasa la pertenencia sin red: el 502 lo da la composición.
    inmueblesFalso().caer();
    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}/documento`)
      .set(...conToken(arrendatario.token));
    inmueblesFalso().levantar();

    expect(respuesta.statusCode).toBe(502);
    expect(respuesta.header['content-type']).toMatch(/json/);
    expect(respuesta.body.mensaje).toBeDefined();
  });
});
