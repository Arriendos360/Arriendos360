/**
 * Pruebas de la costura de enrutamiento del gateway.
 *
 * No tocan PostgreSQL: montan un Express minimo con solo el middleware de
 * enrutamiento y un servicio HTTP falso que hace eco de lo que recibe. Eso
 * permite ejercitar el modo remoto sin tener microservicios reales, que es
 * precisamente lo que todavia no existe.
 *
 * El entorno se inyecta por parametro (`crearEnrutadorGateway({ entorno })`),
 * nunca por `process.env`, para no contaminar las otras suites.
 */

const express = require('express');
const http = require('http');
const request = require('supertest');

const {
    crearEnrutadorGateway,
    describirEnrutamiento,
    modoDe,
    resolverPrefijo,
    TABLA_RUTAS,
    urlDestino
} = require('../src/routing');
const { firmarOrigenCliente, verificarOrigenCliente } = require('arriendos360-shared');
const { crearConfianzaDeProxy } = require('../src/routing/origen');

const SECRETO_SERVICIO = 'secreto-de-servicio-de-prueba';

const PDF_DE_PRUEBA = Buffer.from('%PDF-1.4\n%bytes de prueba\n%%EOF');

let servicioFalso;
let urlServicio;
let urlServicioCaido;
let app;

/**
 * Reserva un puerto y lo libera enseguida, para tener una direccion donde con
 * certeza no escucha nadie. Sirve para provocar ECONNREFUSED de forma
 * determinista, sin quemar un numero de puerto fijo que podria estar ocupado.
 */
const obtenerPuertoLibre = () =>
    new Promise((resolver) => {
        const provisional = http.createServer();
        provisional.listen(0, '127.0.0.1', () => {
            const { port } = provisional.address();
            provisional.close(() => resolver(port));
        });
    });

beforeAll(async () => {
    // Servicio falso: responde 404 en una ruta concreta y hace eco en el resto.
    servicioFalso = http.createServer((req, res) => {
        const trozos = [];
        req.on('data', (trozo) => trozos.push(trozo));
        req.on('end', () => {
            const cuerpo = Buffer.concat(trozos);

            if (req.url.startsWith('/api/inmuebles/no-existe')) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ mensaje: 'Inmueble no encontrado' }));
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'X-Servicio': 'falso'
            });
            res.end(
                JSON.stringify({
                    metodo: req.method,
                    url: req.url,
                    autorizacion: req.headers.authorization || null,
                    origen: req.headers['x-origen-cliente'] || null,
                    reenviadoPara: req.headers['x-forwarded-for'] || null,
                    contentType: req.headers['content-type'] || null,
                    bytesCuerpo: cuerpo.length,
                    cuerpoTexto: cuerpo.toString('utf8')
                })
            );
        });
    });

    await new Promise((resolver) => servicioFalso.listen(0, '127.0.0.1', resolver));
    urlServicio = `http://127.0.0.1:${servicioFalso.address().port}`;
    urlServicioCaido = `http://127.0.0.1:${await obtenerPuertoLibre()}`;

    // Entorno de prueba: inmuebles apunta al servicio falso, contratos a uno
    // caido, identidad vacio y financiero solo espacios (debe contar como vacio).
    const entorno = {
        MS_IDENTIDAD_URL: '',
        MS_INMUEBLES_URL: urlServicio,
        MS_CONTRATOS_URL: urlServicioCaido,
        MS_FINANCIERO_URL: '   '
    };

    app = express();
    // Un proxy de confianza delante, como el ingreso de Container Apps.
    app.set('trust proxy', crearConfianzaDeProxy({ PROXY_SALTOS_CONFIANZA: '1' }));
    app.use(crearEnrutadorGateway({ entorno, timeoutMs: 2000, secretoServicio: SECRETO_SERVICIO }));
    app.use(express.json());

    // Rutas "locales" de mentira, que hacen las veces del monolito.
    app.post('/api/auth/login', (req, res) => res.json({ desde: 'local', recibido: req.body }));
    app.get('/api/pagos', (req, res) => res.json({ desde: 'local' }));
    app.get('/api/dashboard/resumen', (req, res) => res.json({ desde: 'local' }));
    app.get('/', (req, res) => res.json({ desde: 'local-raiz' }));
});

afterAll(async () => {
    if (servicioFalso) {
        await new Promise((resolver) => servicioFalso.close(resolver));
    }
});

describe('Costura de enrutamiento: modo local', () => {
    test('un prefijo con la variable de entorno vacia se resuelve localmente', async () => {
        const respuesta = await request(app).get('/api/pagos');

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.desde).toBe('local');
    });

    test('/api/dashboard es siempre local: vive en el gateway por diseno', async () => {
        const respuesta = await request(app).get('/api/dashboard/resumen');

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.desde).toBe('local');
    });

    test('una ruta fuera de la tabla pasa de largo sin tocarla', async () => {
        const respuesta = await request(app).get('/');

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.desde).toBe('local-raiz');
    });

    test('el cuerpo JSON sigue llegando parseado a express.json()', async () => {
        // Comprueba el orden de montaje: la costura va antes del parser, pero al
        // no reenviar debe dejar el stream intacto para que el parser lo lea.
        const respuesta = await request(app)
            .post('/api/auth/login')
            .send({ correo: 'prueba@arriendos360.test' });

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.desde).toBe('local');
        expect(respuesta.body.recibido).toEqual({ correo: 'prueba@arriendos360.test' });
    });
});

describe('Origen del cliente', () => {
    /** La IP que el servicio de destino puede verificar, o null. */
    const origenDe = (respuesta) =>
        verificarOrigenCliente(respuesta.body.origen, {
            destinatario: 'ms-inmuebles',
            secreto: SECRETO_SERVICIO
        });

    test('firma la IP de CADA petición: un token nunca se reutiliza entre clientes', async () => {
        // Si la firma se cacheara, la segunda petición llegaría con la IP de la primera y
        // ms-identidad contaría a todos los clientes bajo el primero que pasó.
        const primera = await request(app).get('/api/inmuebles').set('X-Forwarded-For', '203.0.113.7');
        const segunda = await request(app).get('/api/inmuebles').set('X-Forwarded-For', '198.51.100.9');
        const tercera = await request(app).get('/api/inmuebles').set('X-Forwarded-For', '203.0.113.7');

        expect(origenDe(primera)).toBe('203.0.113.7');
        expect(origenDe(segunda)).toBe('198.51.100.9');
        expect(origenDe(tercera)).toBe('203.0.113.7');
        // Ni la misma IP reutiliza el token.
        expect(new Set([primera.body.origen, segunda.body.origen, tercera.body.origen]).size).toBe(3);
    });

    test('sobrescribe X-Forwarded-For: sólo llega la IP que resolvió el gateway', async () => {
        const respuesta = await request(app)
            .get('/api/inmuebles')
            .set('X-Forwarded-For', '10.9.9.9, 203.0.113.7');

        expect(respuesta.body.reenviadoPara).toBe('203.0.113.7');
        expect(origenDe(respuesta)).toBe('203.0.113.7');
    });

    test('una cabecera de origen escrita por el cliente se descarta', async () => {
        const falsa = firmarOrigenCliente({
            ip: '1.1.1.1',
            emisor: 'gateway',
            destinatario: 'ms-inmuebles',
            secreto: 'clave-que-no-es-la-del-gateway'
        });

        const respuesta = await request(app).get('/api/inmuebles').set('X-Origen-Cliente', falsa);

        expect(respuesta.body.origen).not.toBe(falsa);
        expect(origenDe(respuesta)).not.toBe('1.1.1.1');
    });

    test('sin proxies de confianza, el X-Forwarded-For del cliente no cuenta', async () => {
        const sinProxy = express();
        sinProxy.set('trust proxy', crearConfianzaDeProxy({}));
        sinProxy.use(
            crearEnrutadorGateway({
                entorno: { MS_INMUEBLES_URL: urlServicio },
                timeoutMs: 2000,
                secretoServicio: SECRETO_SERVICIO
            })
        );

        const respuesta = await request(sinProxy).get('/api/inmuebles').set('X-Forwarded-For', '203.0.113.7');

        expect(origenDe(respuesta)).not.toBe('203.0.113.7');
        expect(respuesta.body.reenviadoPara).not.toContain('203.0.113.7');
    });
});

describe('Costura de enrutamiento: modo remoto', () => {
    test('conserva metodo, ruta y query string', async () => {
        const respuesta = await request(app).get('/api/inmuebles?ciudad=Bogota&pagina=2');

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.metodo).toBe('GET');
        expect(respuesta.body.url).toBe('/api/inmuebles?ciudad=Bogota&pagina=2');
    });

    test('propaga la cabecera Authorization', async () => {
        // Es lo que permite que el servicio destino verifique el token por su
        // cuenta con el secreto compartido, sin llamar a MS-Identidad.
        const respuesta = await request(app)
            .get('/api/inmuebles')
            .set('Authorization', 'Bearer token-de-prueba');

        expect(respuesta.body.autorizacion).toBe('Bearer token-de-prueba');
    });

    test('conserva el cuerpo JSON de un POST', async () => {
        const cuerpo = { alias: 'Apto 101', ciudad: 'Bogota' };
        const respuesta = await request(app).post('/api/inmuebles').send(cuerpo);

        expect(respuesta.body.metodo).toBe('POST');
        expect(JSON.parse(respuesta.body.cuerpoTexto)).toEqual(cuerpo);
    });

    test('reenvia multipart/form-data intacto, con boundary y bytes del PDF', async () => {
        // El caso que motiva el streaming del cuerpo: la carga de anexos de
        // contrato del Capitulo 2 viaja como multipart con un PDF adjunto.
        const respuesta = await request(app)
            .post('/api/inmuebles/anexos')
            .field('tipo', 'CONTRATO_FIRMADO')
            .attach('file', PDF_DE_PRUEBA, 'anexo.pdf');

        expect(respuesta.status).toBe(200);
        expect(respuesta.body.contentType).toMatch(/^multipart\/form-data; boundary=/);
        expect(respuesta.body.cuerpoTexto).toContain('CONTRATO_FIRMADO');
        expect(respuesta.body.cuerpoTexto).toContain('anexo.pdf');
        expect(respuesta.body.cuerpoTexto).toContain('%PDF-1.4');
        expect(respuesta.body.bytesCuerpo).toBeGreaterThan(PDF_DE_PRUEBA.length);
    });

    test('conserva el codigo de estado y el cuerpo de error del servicio', async () => {
        const respuesta = await request(app).get('/api/inmuebles/no-existe');

        expect(respuesta.status).toBe(404);
        expect(respuesta.body).toEqual({ mensaje: 'Inmueble no encontrado' });
    });

    test('conserva las cabeceras de la respuesta del servicio', async () => {
        const respuesta = await request(app).get('/api/inmuebles');

        expect(respuesta.headers['x-servicio']).toBe('falso');
    });

    test('un servicio caido produce 502 con la forma de error del proyecto', async () => {
        const respuesta = await request(app).get('/api/contratos');

        expect(respuesta.status).toBe(502);
        expect(typeof respuesta.body.mensaje).toBe('string');
        expect(respuesta.body.mensaje).toContain('ms-contratos');
    });
});

describe('Tabla de enrutamiento', () => {
    test('el prefijo coincide por segmento completo, no por substring', async () => {
        // /api/inmueblesfalsos no debe caer en /api/inmuebles y acabar reenviado.
        expect(resolverPrefijo('/api/inmueblesfalsos')).toBeNull();

        const respuesta = await request(app).get('/api/inmueblesfalsos');
        expect(respuesta.status).toBe(404);
    });
});

describe('Descripcion del enrutamiento para el arranque', () => {
    test('lista cada prefijo con su modo y la URL destino cuando es remoto', () => {
        const entorno = { MS_INMUEBLES_URL: 'http://ms-inmuebles:3012' };
        const descripcion = describirEnrutamiento(entorno);

        // Aparecen los seis prefijos de la tabla.
        for (const entrada of TABLA_RUTAS) {
            expect(descripcion).toContain(entrada.prefijo);
        }

        // El remoto muestra destino y nombre de servicio.
        expect(descripcion).toMatch(
            /\/api\/inmuebles\s+remoto\s+->\s+http:\/\/ms-inmuebles:3012\s+\(ms-inmuebles\)/
        );

        // Los locales dicen por que lo son.
        expect(descripcion).toContain('MS_IDENTIDAD_URL sin definir');
        expect(descripcion).toContain('siempre local, no tiene servicio propio');
        expect(descripcion).toContain('6 prefijos, 1 remoto');
    });

    test('sin variables definidas, los seis prefijos resuelven en local', () => {
        // Es el estado de hoy: la costura no cambia nada observable.
        const entorno = {};

        for (const entrada of TABLA_RUTAS) {
            expect(modoDe(entrada, entorno)).toBe('local');
            expect(urlDestino(entrada, entorno)).toBeNull();
        }

        expect(describirEnrutamiento(entorno)).toContain('6 prefijos, 0 remotos');
    });
});
