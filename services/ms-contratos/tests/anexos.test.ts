import request from 'supertest';

import {
  app,
  cerrarEntorno,
  conToken,
  crearContrato,
  firmarToken,
  inmuebleDe,
  inmueblesFalso,
  inquilinoDe,
  prepararEntorno,
  propietario,
} from './utiles/entorno';

/**
 * Anexos: subida, listado, descarga y borrado.
 *
 * Vienen de `apps/gateway/tests/anexos.test.js` y se mudan con el codigo. Lo que
 * el paso 6d cambia es de donde sale el ABAC —ahora de `services/pertenencia.ts`,
 * en un solo sitio— y eso es lo que la primera seccion vuelve a comprobar.
 *
 * El almacenamiento es el de DISCO, que no es un doble sino la implementacion de
 * desarrollo. `prepararEntorno` la apunta a un directorio temporal para no dejar
 * archivos en el arbol del repositorio.
 */

/** Un PDF minimo pero valido: empieza por la firma `%PDF-`. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n', 'ascii');

/** Algo que NO es un PDF, aunque se declare como tal. */
const NO_PDF = Buffer.from('MZ\x90\x00 esto es un ejecutable', 'binary');

let duenio: ReturnType<typeof propietario>;
let otro: ReturnType<typeof propietario>;
let arrendatario: ReturnType<typeof propietario>;
let idContrato: string;

beforeAll(async () => {
  await prepararEntorno();

  duenio = propietario();
  otro = propietario();

  const idInquilino = inquilinoDe();
  arrendatario = firmarToken({ sub: idInquilino, roles: ['INQUILINO'] });

  const creado = await crearContrato(duenio.token, inmuebleDe(duenio.sub), idInquilino);
  idContrato = creado.id;
});

afterAll(async () => {
  await cerrarEntorno();
});

describe('Subida', () => {
  test('el propietario adjunta un PDF y queda con su tipo', async () => {
    const respuesta = await request(app)
      .post(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(duenio.token))
      .field('tipo', 'CONTRATO_FIRMADO')
      .attach('file', PDF, { filename: 'contrato.pdf', contentType: 'application/pdf' });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.body.anexo.tipo).toBe('CONTRATO_FIRMADO');
    // `archivo_anexo` es una referencia opaca del almacenamiento, no una ruta.
    expect(respuesta.body.anexo.archivo_anexo).toContain(idContrato);
  });

  test('un archivo que no es PDF se rechaza aunque lo declare', async () => {
    // La comprobacion que de verdad decide son los primeros bytes: el `mimetype`
    // del multipart lo declara quien sube, asi que no prueba nada por si solo.
    const respuesta = await request(app)
      .post(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(duenio.token))
      .field('tipo', 'OTROSI')
      .attach('file', NO_PDF, { filename: 'trampa.pdf', contentType: 'application/pdf' });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.body.mensaje).toContain('no es un PDF');
  });

  test('sin `tipo` no se sube', async () => {
    const respuesta = await request(app)
      .post(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(duenio.token))
      .attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });

    expect(respuesta.statusCode).toBe(400);
  });

  test('el inquilino NO puede adjuntar: sube el arrendador', async () => {
    const respuesta = await request(app)
      .post(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(arrendatario.token))
      .field('tipo', 'OTROSI')
      .attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });

    expect(respuesta.statusCode).toBe(403);
  });

  test('un contrato ajeno responde 404, no 403', async () => {
    const respuesta = await request(app)
      .post(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(otro.token))
      .field('tipo', 'OTROSI')
      .attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });

    expect(respuesta.statusCode).toBe(404);
  });
});

describe('Listado y descarga: las DOS partes leen', () => {
  test('el propietario lista los anexos de su contrato', async () => {
    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.length).toBeGreaterThan(0);
    // `archivo_anexo` NO sale: es una referencia interna del almacenamiento y
    // publicarla solo daria pistas de como estan guardados los archivos.
    expect(respuesta.body[0].archivo_anexo).toBeUndefined();
  });

  test('el inquilino tambien: un inquilino tiene derecho a su contrato firmado', async () => {
    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(arrendatario.token));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body.length).toBeGreaterThan(0);
  });

  test('y puede descargarlo aunque ms-inmuebles este caido', async () => {
    // Su mitad de la disyuncion es local: `id_inquilino` esta en la misma fila.
    // La disyuncion se evalua en el orden en que se puede.
    const lista = await request(app)
      .get(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(arrendatario.token));
    const idAnexo = lista.body[0].id_anexo;

    inmueblesFalso().caer();

    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}/anexos/${idAnexo}`)
      .set(...conToken(arrendatario.token));

    inmueblesFalso().levantar();

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.header['content-type']).toBe('application/pdf');
    // `attachment` y no `inline`: es contenido que sube un usuario y se lo baja
    // otro. Y `nosniff`, para que el navegador no adivine otro tipo.
    expect(respuesta.header['content-disposition']).toContain('attachment');
    expect(respuesta.header['x-content-type-options']).toBe('nosniff');
  });

  test('un anexo de OTRO contrato no se descarga desde este', async () => {
    // Sin la condicion `id_contrato` en la consulta, quien tenga un contrato
    // propio podria bajarse cualquier anexo del sistema poniendo su id en la URL.
    const otroInquilino = inquilinoDe();
    const segundo = await crearContrato(
      duenio.token,
      inmuebleDe(duenio.sub, 'Segundo'),
      otroInquilino,
    );

    await request(app)
      .post(`/api/contratos/${segundo.id}/anexos`)
      .set(...conToken(duenio.token))
      .field('tipo', 'CONTRATO_FIRMADO')
      .attach('file', PDF, { filename: 'otro.pdf', contentType: 'application/pdf' });

    const delSegundo = await request(app)
      .get(`/api/contratos/${segundo.id}/anexos`)
      .set(...conToken(duenio.token));
    const idAjeno = delSegundo.body[0].id_anexo;

    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}/anexos/${idAjeno}`)
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(404);
  });

  test('un tercero no ve nada, ni siquiera la lista', async () => {
    const respuesta = await request(app)
      .get(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(otro.token));

    expect(respuesta.statusCode).toBe(404);
  });
});

describe('Borrado', () => {
  test('el propietario borra y el anexo desaparece de la lista', async () => {
    const lista = await request(app)
      .get(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(duenio.token));
    const antes = lista.body.length;
    const idAnexo = lista.body[0].id_anexo;

    const respuesta = await request(app)
      .delete(`/api/contratos/${idContrato}/anexos/${idAnexo}`)
      .set(...conToken(duenio.token));

    expect(respuesta.statusCode).toBe(200);

    const despues = await request(app)
      .get(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(duenio.token));
    expect(despues.body).toHaveLength(antes - 1);
  });

  test('el inquilino no borra', async () => {
    const lista = await request(app)
      .get(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(duenio.token));

    if (lista.body.length === 0) {
      await request(app)
        .post(`/api/contratos/${idContrato}/anexos`)
        .set(...conToken(duenio.token))
        .field('tipo', 'OTROSI')
        .attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });
    }

    const actual = await request(app)
      .get(`/api/contratos/${idContrato}/anexos`)
      .set(...conToken(duenio.token));

    const respuesta = await request(app)
      .delete(`/api/contratos/${idContrato}/anexos/${actual.body[0].id_anexo}`)
      .set(...conToken(arrendatario.token));

    expect(respuesta.statusCode).toBe(403);
  });
});
