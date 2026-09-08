/**
 * Anexos: subir, listar, descargar y borrar.
 *
 * Lo que se persigue aquí son las tres cosas que este endpoint puede hacer mal y
 * que no se ven mirando la respuesta feliz:
 *
 *   1. Aceptar algo que no es un PDF porque el cliente dijo que lo era.
 *   2. Tragarse un archivo tan grande que tumbe la réplica.
 *   3. Servirle a alguien el contrato de otro.
 *
 * El almacenamiento es el de disco, contra un directorio temporal fuera del
 * repositorio. No es un doble: es la implementación que corre en desarrollo, con
 * su propia lógica, y probarla aquí es lo que hace que el camino completo
 * —multipart, validación, escritura, streaming— quede cubierto sin Azure.
 */

const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');

const {
    CONTRASENA_POR_DEFECTO,
    app,
    cerrarEntorno,
    conToken,
    crearInmueble,
    crearInquilino,
    iniciarSesion,
    prepararEntorno,
    registrarPropietario
} = require('./utiles/entorno');
const { Anexo } = require('../src/models');
const {
    AlmacenamientoDisco,
    almacenamiento,
    usarAlmacenamiento
} = require('../src/services/almacenamiento');
const { TAMANO_MAXIMO_BYTES } = require('../src/middlewares/upload.middleware');

/** Un PDF de verdad: lo que importa son los cinco primeros bytes. */
const PDF = Buffer.from('%PDF-1.7\ncontrato firmado\n%%EOF');

/** Un ejecutable de Windows. Empieza por `MZ`, no por `%PDF-`. */
const NO_PDF = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(500, 0x90)]);

let raiz;
let almacenPrevio;

let tokenProp;
let tokenInquilino;
let idInquilino;
let idContrato;
let idContratoAjeno;

/** Firma un contrato sobre un inmueble nuevo y devuelve su id. */
const firmarContrato = async (direccion, idDelInquilino) => {
    const { id: idInmueble } = await crearInmueble(tokenProp, { direccion });

    const respuesta = await request(app)
        .post('/api/contratos')
        .set(...conToken(tokenProp))
        .send({
            id_inmueble: idInmueble,
            id_inquilino: idDelInquilino,
            inicio: '2026-01-01',
            fin: '2026-12-31',
            canon: 1200000
        });

    return respuesta.body.contrato.id_contrato;
};

/** Sube un anexo al contrato indicado. `contenido` puede no ser un PDF. */
const subir = (idDelContrato, token, contenido = PDF, opciones = {}) => {
    const peticion = request(app)
        .post(`/api/contratos/${idDelContrato}/anexos`)
        .set(...conToken(token))
        .field('tipo', opciones.tipo ?? 'CONTRATO_FIRMADO');

    return peticion.attach('file', contenido, {
        filename: opciones.nombre ?? 'contrato.pdf',
        contentType: opciones.contentType ?? 'application/pdf'
    });
};

beforeAll(async () => {
    await prepararEntorno();

    raiz = await fsp.mkdtemp(path.join(os.tmpdir(), 'arriendos360-anexos-'));
    almacenPrevio = almacenamiento();
    usarAlmacenamiento(new AlmacenamientoDisco(raiz));

    const propietario = await registrarPropietario({
        email: 'prop@anexos.com',
        nombres: 'Prop',
        apellidos: 'Anexo',
        documento: 'PA1'
    });
    tokenProp = propietario.token;

    const inquilino = await crearInquilino(tokenProp, {
        email: 'inq@anexos.com',
        nombres: 'Inq',
        apellidos: 'Anexo',
        documento: 'IA1'
    });
    idInquilino = inquilino.id;
    tokenInquilino = (await iniciarSesion('inq@anexos.com', CONTRASENA_POR_DEFECTO)).body.token;

    const otroInquilino = await crearInquilino(tokenProp, {
        email: 'otro@anexos.com',
        nombres: 'Otro',
        apellidos: 'Inquilino',
        documento: 'OA1'
    });

    idContrato = await firmarContrato('Anexos 1', idInquilino);
    idContratoAjeno = await firmarContrato('Anexos 2', otroInquilino.id);
});

afterAll(async () => {
    usarAlmacenamiento(almacenPrevio);
    await fsp.rm(raiz, { recursive: true, force: true });
    await cerrarEntorno();
});

describe('El anexo es un paso APARTE de crear el contrato', () => {
    test('crear un contrato ya no acepta el PDF y no deja anexos', async () => {
        // El Capítulo 2 lo pide así: el anexo necesita un `id_contrato` que
        // todavía no existe cuando se firma.
        const nuevo = await firmarContrato('Sin anexo al nacer', idInquilino);

        const listado = await request(app)
            .get(`/api/contratos/${nuevo}/anexos`)
            .set(...conToken(tokenProp));

        expect(listado.statusCode).toBe(200);
        expect(listado.body).toEqual([]);
    });

    test('el contrato ya no tiene `url_pdf`', async () => {
        const respuesta = await request(app)
            .get(`/api/contratos/${idContrato}`)
            .set(...conToken(tokenProp));

        expect(respuesta.body).not.toHaveProperty('url_pdf');
    });
});

describe('Subir un anexo', () => {
    test('un PDF válido se acepta y se guarda', async () => {
        const respuesta = await subir(idContrato, tokenProp);

        expect(respuesta.statusCode).toBe(201);
        expect(respuesta.body.anexo.tipo).toBe('CONTRATO_FIRMADO');
        expect(respuesta.body.anexo.id_contrato).toBe(idContrato);

        // Y el archivo está de verdad en el almacenamiento, no sólo la fila.
        const fila = await Anexo.findByPk(respuesta.body.anexo.id_anexo);
        const archivo = await almacenamiento().leer(fila.archivo_anexo);
        expect(archivo).not.toBeNull();
        expect(archivo.tamano).toBe(PDF.length);
    });

    test('un archivo que NO es PDF se rechaza aunque diga que lo es', async () => {
        // El caso que el filtro anterior dejaba pasar: renombrar el archivo a
        // `.pdf` y declarar `application/pdf` era todo lo que hacía falta. Lo que
        // decide son los primeros bytes, que aquí son `MZ` — un ejecutable.
        const respuesta = await subir(idContrato, tokenProp, NO_PDF, {
            nombre: 'contrato.pdf',
            contentType: 'application/pdf'
        });

        expect(respuesta.statusCode).toBe(400);
        expect(respuesta.body.mensaje).toContain('no es un PDF');
    });

    test('y tampoco cuela declarando otro tipo', async () => {
        // Aquí corta el `fileFilter` de multer, antes de leer el archivo. Son dos
        // barreras para dos cosas distintas: ésta ataja el error honesto.
        const respuesta = await subir(idContrato, tokenProp, NO_PDF, {
            nombre: 'foto.png',
            contentType: 'image/png'
        });

        expect(respuesta.statusCode).toBe(400);
        expect(respuesta.body.mensaje).toContain('PDF');
    });

    test('un archivo por encima del tope devuelve 413', async () => {
        // 413 y no 400: el código existe para esto y le dice al cliente que el
        // problema es el tamaño, no el contenido. Empieza por `%PDF-` a
        // propósito, para que lo único que lo rechace sea el tope.
        const enorme = Buffer.concat([PDF, Buffer.alloc(TAMANO_MAXIMO_BYTES, 0x20)]);

        const respuesta = await subir(idContrato, tokenProp, enorme);

        expect(respuesta.statusCode).toBe(413);
        expect(respuesta.body.mensaje).toContain('MB');
    });

    test('un archivo justo por debajo del tope entra', async () => {
        // La otra mitad: que el límite esté donde se dice y no un byte antes.
        const casiEnorme = Buffer.concat([
            PDF,
            Buffer.alloc(TAMANO_MAXIMO_BYTES - PDF.length - 1, 0x20)
        ]);

        const respuesta = await subir(idContrato, tokenProp, casiEnorme);

        expect(respuesta.statusCode).toBe(201);
    });

    test('sin `tipo` se rechaza', async () => {
        const respuesta = await request(app)
            .post(`/api/contratos/${idContrato}/anexos`)
            .set(...conToken(tokenProp))
            .attach('file', PDF, { filename: 'c.pdf', contentType: 'application/pdf' });

        expect(respuesta.statusCode).toBe(400);
        expect(respuesta.body.mensaje).toContain('tipo');
    });

    test('el tipo es un enum ABIERTO: un valor no listado se acepta', async () => {
        // A diferencia de `inmuebles.tipo`, que es catálogo cerrado. El documento
        // enumera CONTRATO_FIRMADO y OTROSI "etc.", así que un otrosí de una
        // modalidad que nadie previó no puede quedar bloqueado.
        const respuesta = await subir(idContrato, tokenProp, PDF, { tipo: 'ACTA_DE_ENTREGA' });

        expect(respuesta.statusCode).toBe(201);
        expect(respuesta.body.anexo.tipo).toBe('ACTA_DE_ENTREGA');
    });

    test('el inquilino NO puede subir: lo corta la matriz RBAC', async () => {
        const respuesta = await subir(idContrato, tokenInquilino);

        expect(respuesta.statusCode).toBe(403);
    });
});

describe('Listar anexos', () => {
    test('el propietario ve los suyos, sin la referencia del almacenamiento', async () => {
        const respuesta = await request(app)
            .get(`/api/contratos/${idContrato}/anexos`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(200);
        expect(respuesta.body.length).toBeGreaterThan(0);
        // `archivo_anexo` es interno: al cliente no le sirve y publicarlo daría
        // pistas de cómo están guardados los archivos.
        expect(respuesta.body[0]).not.toHaveProperty('archivo_anexo');
    });

    test('el inquilino ve los de SU contrato', async () => {
        const respuesta = await request(app)
            .get(`/api/contratos/${idContrato}/anexos`)
            .set(...conToken(tokenInquilino));

        expect(respuesta.statusCode).toBe(200);
        expect(respuesta.body.length).toBeGreaterThan(0);
    });

    test('y 404 sobre un contrato que no es suyo', async () => {
        const respuesta = await request(app)
            .get(`/api/contratos/${idContratoAjeno}/anexos`)
            .set(...conToken(tokenInquilino));

        expect(respuesta.statusCode).toBe(404);
    });
});

describe('Descargar un anexo', () => {
    let idAnexo;

    beforeAll(async () => {
        idAnexo = (await subir(idContrato, tokenProp)).body.anexo.id_anexo;
    });

    test('el propietario se lo descarga y el contenido es el que subió', async () => {
        const respuesta = await request(app)
            .get(`/api/contratos/${idContrato}/anexos/${idAnexo}`)
            .set(...conToken(tokenProp))
            .buffer()
            .parse((res, cb) => {
                const trozos = [];
                res.on('data', (t) => trozos.push(t));
                res.on('end', () => cb(null, Buffer.concat(trozos)));
            });

        expect(respuesta.statusCode).toBe(200);
        expect(respuesta.headers['content-type']).toContain('application/pdf');
        expect(respuesta.headers['content-disposition']).toContain('attachment');
        expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
        expect(respuesta.body).toEqual(PDF);
    });

    test('EL INQUILINO se descarga el anexo de su contrato', async () => {
        // Es su contrato firmado: tiene derecho a tenerlo. Y este camino del
        // ABAC no cuesta una petición a ms-inmuebles — `id_inquilino` está en la
        // misma fila— así que funciona aunque ese servicio esté caído.
        const respuesta = await request(app)
            .get(`/api/contratos/${idContrato}/anexos/${idAnexo}`)
            .set(...conToken(tokenInquilino));

        expect(respuesta.statusCode).toBe(200);
    });

    test('pero el de OTRO contrato le da 404', async () => {
        const ajeno = (await subir(idContratoAjeno, tokenProp)).body.anexo.id_anexo;

        const respuesta = await request(app)
            .get(`/api/contratos/${idContratoAjeno}/anexos/${ajeno}`)
            .set(...conToken(tokenInquilino));

        // 404 y no 403: un 403 confirmaría que ese contrato existe.
        expect(respuesta.statusCode).toBe(404);
    });

    test('un anexo de otro contrato por la URL del mío también es 404', async () => {
        // Sin la condición `id_contrato` en la consulta, el ABAC habría dicho que
        // sí al contrato y el anexo habría venido de otro.
        const ajeno = (await subir(idContratoAjeno, tokenProp)).body.anexo.id_anexo;

        const respuesta = await request(app)
            .get(`/api/contratos/${idContrato}/anexos/${ajeno}`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(404);
    });

    test('si el archivo ya no está en el almacenamiento, 404 y no una respuesta vacía', async () => {
        const otro = (await subir(idContrato, tokenProp)).body.anexo.id_anexo;
        const fila = await Anexo.findByPk(otro);
        await almacenamiento().eliminar(fila.archivo_anexo);

        const respuesta = await request(app)
            .get(`/api/contratos/${idContrato}/anexos/${otro}`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(404);
        expect(respuesta.body.mensaje).toContain('disponible');
    });
});

describe('Eliminar un anexo', () => {
    test('el propietario lo borra, y con él el archivo', async () => {
        const idAnexo = (await subir(idContrato, tokenProp)).body.anexo.id_anexo;
        const fila = await Anexo.findByPk(idAnexo);
        const referencia = fila.archivo_anexo;

        const respuesta = await request(app)
            .delete(`/api/contratos/${idContrato}/anexos/${idAnexo}`)
            .set(...conToken(tokenProp));

        expect(respuesta.statusCode).toBe(200);
        expect(await Anexo.findByPk(idAnexo)).toBeNull();
        expect(await almacenamiento().leer(referencia)).toBeNull();
    });

    test('el inquilino no puede borrar', async () => {
        const idAnexo = (await subir(idContrato, tokenProp)).body.anexo.id_anexo;

        const respuesta = await request(app)
            .delete(`/api/contratos/${idContrato}/anexos/${idAnexo}`)
            .set(...conToken(tokenInquilino));

        expect(respuesta.statusCode).toBe(403);
        expect(await Anexo.findByPk(idAnexo)).not.toBeNull();
    });
});

describe('`/uploads` ya no existe', () => {
    test('la ruta que servía los contratos sin token responde 404', async () => {
        // Era la trampa anotada en CLAUDE.md: `express.static` iba antes de todo
        // middleware de token, así que los PDF eran públicos para quien supiera
        // la URL. Ahora no hay nada que servir ahí.
        const respuesta = await request(app).get('/uploads/contratos/cualquiera.pdf');

        expect(respuesta.statusCode).toBe(404);
    });
});
