/**
 * Integración: los caminos críticos contra el stack real.
 *
 * Esta suite es la contrapartida de los dobles. Cada servicio prueba su lógica
 * contra dobles, rápido y sin levantar nada; eso deja un hueco que ningún doble
 * puede tapar: **que el contrato entre los dos sea cierto**. Un doble que se
 * desvía del servicio real deja las suites en verde y el sistema roto.
 *
 * Por eso es corta y sólo recorre lo que no puede fallar en una demostración:
 * entrar, firmar un contrato, registrar un pago y —desde el paso 7— recuperar una
 * contraseña. No duplica cobertura de casos borde; para eso están las suites de
 * cada servicio.
 *
 * El último gana su sitio por el mismo criterio que los otros tres, aplicado a un
 * camino que el paso 7 partió por la mitad: `/recuperar` ya no manda el correo,
 * anota un evento que recorre ms-identidad → ms-notificaciones → ms-identidad
 * otra vez. Son tres fronteras nuevas, y el síntoma de que una esté mal es el peor
 * posible — nadie recibe el correo y no hay ningún error en ninguna parte.
 *
 * Requiere el stack levantado:
 *
 *   docker compose -f infra/docker-compose.yml up --build -d
 *   npm run test:integracion
 *
 * Usa el runner de Node (`node --test`), no jest: cero dependencias nuevas para
 * algo que casi sólo hace peticiones HTTP y comprueba respuestas.
 *
 * EL «CASI» SON LAS CONSULTAS A LA BASE. Hay dos cosas que no se pueden
 * comprobar por HTTP y que son justamente las que dicen si una extracción está
 * hecha de verdad o sólo a medias:
 *
 *   1. **Qué lleva dentro el evento.** El sobre no aparece en ninguna respuesta
 *      —viaja de ms-contratos a sus suscriptores por la red interna— así que la
 *      única forma de verlo es leer `contratos.eventos_salida`. Que esté ahí y
 *      no en `public` es parte de lo que se comprueba: si apareciera en `public`
 *      el productor seguiría siendo el gateway.
 *
 *   2. **En qué esquema vive cada tabla.** Desde el paso 6e se comprueba que las
 *      cuentas de cobro estén en `financiero` y que `public.cuentas_cobro` y
 *      `public.transacciones` se hayan retirado. El gateway ya no tiene ninguna
 *      tabla, y esa afirmación no se puede hacer desde su API.
 *
 * Se usa `pg`, que es dependencia de la raíz del monorepo desde que el gateway
 * dejó de tener base: no entra nada nuevo.
 *
 * Y `zlib`, que trae Node, para leer los PDF de los comprobantes. Ver
 * `textoDelPdf`.
 */

const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { Client } = require('pg');

// Las credenciales de la base salen del .env de ms-financiero. ANTES salian del
// gateway, «porque era su base y su tabla de salida»; desde el paso 6e el
// gateway no tiene base, asi que no tiene DB_*. Se toma la de un servicio
// cualquiera: la instancia es la misma para todos, lo que cambia es el esquema.
require('dotenv').config({ path: path.resolve(__dirname, '../../services/ms-financiero/.env') });

const GATEWAY = process.env.URL_GATEWAY || 'http://localhost:3001';
const IDENTIDAD = process.env.URL_IDENTIDAD || 'http://localhost:3011';
const INMUEBLES = process.env.URL_INMUEBLES || 'http://localhost:3012';
const CONTRATOS = process.env.URL_CONTRATOS || 'http://localhost:3013';
const FINANCIERO = process.env.URL_FINANCIERO || 'http://localhost:3014';

/** Sufijo único por ejecución: la suite corre contra una base que no se resetea. */
const SELLO = Date.now().toString().slice(-9);

/**
 * El UUID con el que los servicios firman lo que no pide una persona.
 *
 * Aparece aquí porque el estado del inmueble lo mueve ahora un evento, y un
 * evento no tiene un usuario detrás al que atribuirle el cambio.
 */
const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';

/**
 * Reintenta hasta que la respuesta cumpla la condición, o se agote el plazo.
 *
 * Hace falta desde el paso 5 y sólo para lo que el bus resuelve: el sistema pasó
 * a ser consistente EN EL TIEMPO para el estado del inmueble. Afirmarlo justo
 * después de la petición sería afirmar algo que el diseño no promete.
 */
const esperarA = async (obtener, cumple, limiteMs) => {
    const limite = Date.now() + limiteMs;
    let ultima = await obtener();

    while (Date.now() < limite && !cumple(ultima)) {
        await new Promise((r) => setTimeout(r, 500));
        ultima = await obtener();
    }

    return ultima;
};

const pedir = async (metodo, ruta, { token, cuerpo, base = GATEWAY } = {}) => {
    const respuesta = await fetch(base + ruta, {
        method: metodo,
        headers: {
            ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {})
    });

    let datos = null;
    try {
        datos = await respuesta.json();
    } catch {
        /* respuesta sin cuerpo JSON */
    }

    return { estado: respuesta.status, datos };
};

/**
 * Vacía los contadores de limitación de tasa de ms-identidad.
 *
 * Toda la suite llama desde la misma IP, y restablecer admite cinco por hora: sin
 * esto, la tercera ejecución en una hora fallaría por el límite y no por un defecto.
 * Si la tabla todavía no existe —un stack anterior a `database/identidad/007`— no
 * hace nada.
 */
const limpiarLimitesDeTasa = async () => {
    const cliente = new Client({
        host: process.env.DB_HOST_TEST_INTEGRACION || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'arriendos360_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD
    });

    await cliente.connect();
    try {
        await cliente.query(`
            DO $$ BEGIN
                IF to_regclass('identidad.limites_tasa') IS NOT NULL THEN
                    TRUNCATE identidad.limites_tasa;
                END IF;
            END $$;
        `);
    } finally {
        await cliente.end();
    }
};

before(limpiarLimitesDeTasa);

/**
 * El sobre que el gateway anotó para un contrato.
 *
 * Se abre y se cierra una conexión por consulta a propósito: son dos consultas
 * en toda la suite y un pool abierto dejaría el runner colgado al terminar.
 */
const eventoDe = async (idContrato, tipo) => {
    const cliente = new Client({
        host: process.env.DB_HOST_TEST_INTEGRACION || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'arriendos360_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD
    });

    await cliente.connect();
    try {
        const { rows } = await cliente.query(
            `SELECT tipo, version, payload, estado
               FROM contratos.eventos_salida
              WHERE payload->>'id_contrato' = $1 AND tipo = $2`,
            [idContrato, tipo]
        );
        return rows[0] || null;
    } finally {
        await cliente.end();
    }
};

/**
 * El texto imprimible de un PDF de PDFKit.
 *
 * Dos capas: los flujos vienen comprimidos con Flate y el texto va en cadenas
 * hexadecimales dentro de arreglos de kerning. Las dos las resuelve `zlib`, que
 * trae Node — ninguna dependencia nueva. Es el mismo lector que usa
 * `services/ms-financiero/tests/comprobantes.test.ts`, y esta duplicado a
 * proposito: son dos suites que no comparten runner ni lenguaje, y un modulo
 * comun solo para esto ataria la suite de integracion al build de un servicio.
 */
const textoDelPdf = (cuerpo) => {
    const flujos = [];
    let desde = 0;

    for (;;) {
        const inicio = cuerpo.indexOf('stream', desde);
        if (inicio === -1) break;

        const fin = cuerpo.indexOf('endstream', inicio);
        if (fin === -1) break;

        let datos = inicio + 'stream'.length;
        if (cuerpo[datos] === 0x0d) datos += 1;
        if (cuerpo[datos] === 0x0a) datos += 1;

        try {
            flujos.push(zlib.inflateSync(cuerpo.subarray(datos, fin)).toString('latin1'));
        } catch {
            /* no es un flujo Flate: no interesa */
        }

        desde = fin + 'endstream'.length;
    }

    const contenido = flujos.join('\n');
    const bloques = contenido.match(/\[[^\]]*\]\s*TJ|\((?:\\.|[^\\()])*\)\s*Tj/g) || [];

    return bloques
        .map((bloque) => {
            const piezas = bloque.match(/<[0-9A-Fa-f]*>|\((?:\\.|[^\\()])*\)/g) || [];

            return piezas
                .map((pieza) =>
                    pieza.startsWith('<')
                        ? Buffer.from(pieza.slice(1, -1), 'hex').toString('latin1')
                        : pieza.slice(1, -1).replace(/\\([()\\])/g, '$1')
                )
                .join('');
        })
        .join(' ');
};

let tokenPropietario;
let idInquilino;
let idInmueble;
let idContrato;
let idCuentaCobro;

describe('Caminos críticos', () => {
    before(async () => {
        // Falla pronto y con un mensaje útil si el stack no está en pie: es el
        // error más probable de esta suite y el más confuso si no se explica.
        for (const [nombre, url] of [
            ['gateway', `${GATEWAY}/`],
            ['ms-identidad', `${IDENTIDAD}/`],
            ['ms-inmuebles', `${INMUEBLES}/`],
            ['ms-contratos', `${CONTRATOS}/`],
            ['ms-financiero', `${FINANCIERO}/`]
        ]) {
            try {
                await fetch(url, { signal: AbortSignal.timeout(2000) });
            } catch (error) {
                throw new Error(
                    `${nombre} no responde en ${url}. Levanta el stack con ` +
                        '`docker compose -f infra/docker-compose.yml up -d` antes de correr esta suite.'
                );
            }
        }
    });

    it('el login atraviesa la costura hasta ms-identidad', async () => {
        const registro = await pedir('POST', '/api/auth/registro', {
            cuerpo: {
                nombres: 'Integra',
                apellidos: 'Cion',
                email: `integracion_${SELLO}@test.com`,
                contrasena: 'Prueba123',
                telefono: '3000000000',
                documento: `I${SELLO}`
            }
        });
        assert.equal(registro.estado, 201, 'el registro debería crear el usuario');

        const login = await pedir('POST', '/api/auth/login', {
            cuerpo: { email: `integracion_${SELLO}@test.com`, contrasena: 'Prueba123' }
        });

        assert.equal(login.estado, 200);
        assert.equal(login.datos.tipo_token, 'Bearer');
        assert.equal(login.datos.usuario.rol, 'PROPIETARIO');
        assert.match(login.datos.usuario.id, /^[0-9a-f-]{36}$/);

        tokenPropietario = login.datos.token;
    });

    it('el token emitido por ms-identidad vale en el gateway', async () => {
        // Es la prueba de que los dos comparten secreto y forma de claims. Si
        // uno de los dos cambiara el formato, aquí se ve y en los dobles no.
        const respuesta = await pedir('GET', '/api/inmuebles', { token: tokenPropietario });
        assert.equal(respuesta.estado, 200);
    });

    it('crear un contrato compone el inquilino desde ms-identidad', async () => {
        const alta = await pedir('POST', '/api/usuarios/inquilinos', {
            token: tokenPropietario,
            cuerpo: {
                nombres: 'Inqui',
                apellidos: 'Lino',
                email: `inq_${SELLO}@test.com`,
                contrasena: 'Prueba123',
                telefono: '3001111111',
                documento: `Q${SELLO}`
            }
        });
        assert.equal(alta.estado, 201);
        idInquilino = alta.datos.usuario.id;

        const inmueble = await pedir('POST', '/api/inmuebles', {
            token: tokenPropietario,
            cuerpo: {
                direccion: 'Calle Integración 1',
                barrio: 'Centro',
                municipio: 'Bogota',
                tipo: 'apartamento'
            }
        });
        assert.equal(inmueble.estado, 201, JSON.stringify(inmueble.datos));
        idInmueble = inmueble.datos.inmueble.id_inmueble;

        // El inmueble nace disponible. Lo comprueba aquí y no en la suite del
        // servicio porque lo que interesa es el ESTADO INICIAL del camino: la
        // aserción de después —que pasa a arrendado— no dice nada si no se sabe
        // de dónde venía.
        assert.equal(inmueble.datos.inmueble.estado, 'disponible');

        const contrato = await pedir('POST', '/api/contratos', {
            token: tokenPropietario,
            cuerpo: {
                id_inmueble: idInmueble,
                id_inquilino: idInquilino,
                inicio: '2026-01-01',
                fin: '2026-12-31',
                canon: 1500000
            }
        });
        assert.equal(contrato.estado, 201, JSON.stringify(contrato.datos));
        idContrato = contrato.datos.contrato.id_contrato;

        // Lo que este PR cambió: el nombre del inquilino ya no sale de un JOIN,
        // lo compone el gateway por HTTP. Si la composición fallara, aquí
        // vendría `null`.
        const listado = await pedir('GET', '/api/contratos', { token: tokenPropietario });
        const suyo = listado.datos.find((c) => c.id_contrato === idContrato);

        assert.ok(suyo, 'el contrato debería aparecer en el listado');
        assert.equal(suyo.Inquilino.nombres, 'Inqui');
        assert.equal(suyo.Inquilino.documento, `Q${SELLO}`);

        // Y el inmueble tampoco: viene de ms-inmuebles por el mismo camino.
        assert.equal(suyo.Inmueble.direccion, 'Calle Integración 1');
        assert.equal(suyo.Inmueble.tipo, 'apartamento');
    });

    it('firmar el contrato dejó el inmueble arrendado, sin llamada síncrona', async () => {
        // Es LA prueba que ningún doble puede dar, y desde el paso 5 prueba algo
        // distinto de lo que probaba antes. Ya no hay una llamada HTTP del
        // gateway a ms-inmuebles: ms-contratos guardó el contrato y su evento en
        // una sola transacción, su publicador lo entregó y ms-inmuebles dedujo
        // por su cuenta qué significaba. Lo que se verifica es que esa cadena
        // entera funciona contra los servicios reales, y desde el paso 6d
        // atraviesa TRES procesos en vez de dos.
        //
        // Se ESPERA a que converja porque el sistema pasó a ser consistente en
        // el tiempo para este dato. La ventana esperada es el intervalo del
        // publicador; se da margen para no depender del reloj de la máquina.
        const intervalo = Number(process.env.EVENTOS_INTERVALO_MS || 5000);

        const detalle = await esperarA(
            () => pedir('GET', `/api/inmuebles/${idInmueble}`, { token: tokenPropietario }),
            (r) => r.datos && r.datos.estado === 'arrendado',
            intervalo * 3
        );

        assert.equal(detalle.estado, 200);
        assert.equal(
            detalle.datos.estado,
            'arrendado',
            'el inmueble debería converger a arrendado tras la entrega del evento'
        );

        // Y la auditoría registra al SISTEMA, no a la persona. Es el cambio
        // respecto del ADR 0011: el sobre del evento no lleva actor, porque
        // describe un hecho del dominio del emisor y no la petición de alguien a
        // este servicio. Quién firmó está en el contrato.
        assert.equal(detalle.datos.actualizado_por, USUARIO_SISTEMA);
    });

    it('el evento salio de ms-contratos, no del gateway', async () => {
        // La comprobacion de que la extraccion del paso 6d esta hecha de verdad
        // y no a medias. El sobre tiene que estar en la bandeja de ms-contratos
        // —`contratos.eventos_salida`— y la del gateway ya no debe ni existir.
        //
        // Es lo que un doble no puede dar: en las suites del gateway el
        // productor es un doble en memoria, asi que ahi «el evento salio del
        // sitio correcto» no significa nada.
        const evento = await eventoDe(idContrato, 'ContratoFormalizado');

        assert.ok(evento, 'el evento deberia estar en contratos.eventos_salida');
        assert.equal(evento.estado, 'entregado');

        // Y la bandeja del gateway se retiro con `database/dominio/007`.
        const cliente = new Client({
            host: process.env.DB_HOST_TEST_INTEGRACION || 'localhost',
            port: Number(process.env.DB_PORT || 5432),
            database: process.env.DB_NAME || 'arriendos360_db',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD
        });

        await cliente.connect();
        try {
            const { rows } = await cliente.query(
                "SELECT to_regclass('public.eventos_salida') AS tabla"
            );
            assert.equal(
                rows[0].tabla,
                null,
                'public.eventos_salida deberia haberse retirado: el gateway ya no produce'
            );

            // Y tampoco le quedan contratos ni anexos.
            const { rows: restos } = await cliente.query(
                "SELECT to_regclass('public.contratos') AS c, to_regclass('public.anexos') AS a"
            );
            assert.equal(restos[0].c, null, 'public.contratos deberia haberse retirado');
            assert.equal(restos[0].a, null, 'public.anexos deberia haberse retirado');
        } finally {
            await cliente.end();
        }
    });

    it('el evento lleva la fecha_inicio_corte de la COLUMNA, no derivada', async () => {
        // Antes del paso 6a el emisor derivaba la fecha de corte del inicio del
        // contrato, porque la columna no existía. Para demostrar que ya no lo
        // hace no basta con un contrato normal —ahí las dos fechas coinciden y
        // el evento saldría igual de las dos formas— así que se firma uno cuyo
        // ciclo de facturación arranca en una fecha DISTINTA de su inicio.
        const inicio = '2026-05-10';
        const corte = '2026-06-01';

        const inmueble = await pedir('POST', '/api/inmuebles', {
            token: tokenPropietario,
            cuerpo: {
                direccion: 'Calle del Corte 2',
                barrio: 'Centro',
                municipio: 'Bogota',
                tipo: 'casa'
            }
        });
        assert.equal(inmueble.estado, 201, JSON.stringify(inmueble.datos));

        const contrato = await pedir('POST', '/api/contratos', {
            token: tokenPropietario,
            cuerpo: {
                id_inmueble: inmueble.datos.inmueble.id_inmueble,
                id_inquilino: idInquilino,
                inicio,
                fin: '2027-05-09',
                canon: 1800000,
                fecha_inicio_corte: corte,
                fecha_limite_pago: 1
            }
        });
        assert.equal(contrato.estado, 201, JSON.stringify(contrato.datos));

        const guardado = contrato.datos.contrato;
        assert.equal(guardado.fecha_inicio_corte, corte, 'la columna guarda lo pactado');

        const sobre = await eventoDe(guardado.id_contrato, 'ContratoFormalizado');

        assert.ok(sobre, 'el contrato debería haber dejado su evento en la tabla de salida');

        // VERSION 2 desde el paso 7, cuando el sobre ganó `id_inquilino` para que la
        // cuenta de cobro que nace del evento pueda anunciarse. Es la primera vez que
        // este número cambia, y comprobarlo aquí es lo que hace que el campo sirva de
        // algo: un consumidor que reciba un sobre viejo tiene que poder distinguirlo.
        assert.equal(sobre.version, 2);
        assert.equal(
            sobre.payload.id_inquilino,
            idInquilino,
            'la versión 2 lleva el inquilino, que es a quien se le factura'
        );

        // LA aserción del paso 6a: el evento dice lo que dice la fila.
        assert.equal(sobre.payload.fecha_inicio_corte, corte);
        assert.notEqual(
            sobre.payload.fecha_inicio_corte,
            inicio,
            'si el emisor siguiera derivando, aquí vendría el inicio del contrato'
        );

        // Y el canon viaja como número, no como el texto que devuelve DECIMAL.
        assert.equal(sobre.payload.canon, 1800000);
        assert.equal(typeof sobre.payload.canon, 'number');
    });

    it('el anexo se sube, se lista y se descarga por la API autenticada', async () => {
        // Es un camino que ningún doble puede dar: multipart de verdad contra el
        // contenedor, escritura en el almacenamiento y descarga en streaming. Y
        // comprueba algo que sólo falla dentro de Docker — que la raíz relativa
        // de la implementación de disco se resuelva donde se espera.
        const PDF = Buffer.from('%PDF-1.7\ncontrato de integracion\n%%EOF');

        const formulario = new FormData();
        formulario.append('tipo', 'CONTRATO_FIRMADO');
        formulario.append('file', new Blob([PDF], { type: 'application/pdf' }), 'contrato.pdf');

        const subida = await fetch(`${GATEWAY}/api/contratos/${idContrato}/anexos`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenPropietario}` },
            body: formulario
        });
        const creado = await subida.json();

        assert.equal(subida.status, 201, JSON.stringify(creado));
        assert.equal(creado.anexo.tipo, 'CONTRATO_FIRMADO');

        const listado = await pedir('GET', `/api/contratos/${idContrato}/anexos`, {
            token: tokenPropietario
        });
        assert.equal(listado.estado, 200);
        assert.ok(listado.datos.some((a) => a.id_anexo === creado.anexo.id_anexo));
        // La referencia del almacenamiento es interna y no sale en la respuesta.
        assert.equal(listado.datos[0].archivo_anexo, undefined);

        const descarga = await fetch(
            `${GATEWAY}/api/contratos/${idContrato}/anexos/${creado.anexo.id_anexo}`,
            { headers: { Authorization: `Bearer ${tokenPropietario}` } }
        );

        assert.equal(descarga.status, 200);
        assert.match(descarga.headers.get('content-type'), /application\/pdf/);
        assert.equal(Buffer.from(await descarga.arrayBuffer()).equals(PDF), true);
    });

    it('el anexo NO se puede bajar sin token, y /uploads ya no existe', async () => {
        // Las dos mitades de la trampa que este paso cierra. La primera: la ruta
        // nueva exige token, a diferencia de `express.static`. La segunda: la
        // ruta vieja ya no sirve nada.
        const sinToken = await fetch(`${GATEWAY}/api/contratos/${idContrato}/anexos`);
        assert.equal(sinToken.status, 401);

        const vieja = await fetch(`${GATEWAY}/uploads/contratos/cualquiera.pdf`);
        assert.equal(vieja.status, 404);
    });

    it('no se puede borrar un inmueble con contrato activo', async () => {
        // El veto vive en el gateway porque depende de contratos, que ms-inmuebles
        // no puede consultar sin invertir la dirección de las dependencias.
        const borrado = await pedir('DELETE', `/api/inmuebles/${idInmueble}`, {
            token: tokenPropietario
        });

        // 409 y no 403: no es un problema de permisos sino de estado del recurso.
        assert.equal(borrado.estado, 409, JSON.stringify(borrado.datos));
        assert.match(borrado.datos.mensaje, /contrato activo/);

        const sigue = await pedir('GET', `/api/inmuebles/${idInmueble}`, {
            token: tokenPropietario
        });
        assert.equal(sigue.estado, 200);
    });

    it('el evento creó la PRIMERA cuenta de cobro en ms-financiero', async () => {
        // ── LA PRUEBA DEL PASO 6e, Y LA QUE NINGÚN DOBLE PUEDE DAR ──────────
        //
        // Es el caso que el Capítulo 2 especifica textualmente: MS-Contratos
        // emite `ContratoFormalizado` y MS-Financiero inserta la primera
        // `Cuenta_cobro`. Aquí atraviesa TRES procesos y una tabla de salida —
        // el contrato se guardó en ms-contratos, su publicador entregó el sobre
        // y ms-financiero decidió por su cuenta qué significaba.
        //
        // Nadie la crea a mano. Antes de este paso esta suite emitía la cuenta
        // con `POST /api/pagos/cuentas-cobro`; ahora eso sobra, y de hecho
        // chocaría contra el índice único `(id_contrato, inicio)`.
        //
        // Se ESPERA a que converja, como con el estado del inmueble: el sistema
        // es consistente en el tiempo para todo lo que nace de un evento.
        const intervalo = Number(process.env.EVENTOS_INTERVALO_MS || 5000);

        const cuentas = await esperarA(
            () => pedir('GET', `/api/pagos/contrato/${idContrato}`, { token: tokenPropietario }),
            (r) => Array.isArray(r.datos) && r.datos.length > 0,
            intervalo * 3
        );

        assert.equal(cuentas.estado, 200);
        assert.equal(
            cuentas.datos.length,
            1,
            'debería haber UNA cuenta de cobro, creada por el evento'
        );

        const primera = cuentas.datos[0];
        idCuentaCobro = primera.id_cuenta_cobro;

        // Los tres campos que el evento transporta, tal cual.
        assert.equal(Number(primera.valor), 1500000, 'el canon viaja en el evento');
        assert.equal(primera.inicio, '2026-01-01', 'la fecha de corte también');
        assert.equal(primera.estado, 'PENDIENTE');

        // El periodo tesela: `fin` es la víspera del siguiente corte.
        assert.equal(primera.fin, '2026-01-31');

        // El saldo se deriva y llega con el nombre de siempre.
        assert.equal(primera.saldo_pendiente, 1500000);

        // Y la auditoría registra al SISTEMA, no al propietario que firmó: el
        // sobre no lleva actor. Quién firmó está en el contrato.
        assert.equal(primera.creado_por, USUARIO_SISTEMA);
    });

    it('las cuentas de cobro viven en el esquema de ms-financiero', async () => {
        // La comprobación de que la extracción está hecha de verdad y no a
        // medias: las dos tablas tienen que estar en `financiero` y las de
        // `public` haberse retirado con `database/financiero/002`.
        const cliente = new Client({
            host: process.env.DB_HOST_TEST_INTEGRACION || 'localhost',
            port: Number(process.env.DB_PORT || 5432),
            database: process.env.DB_NAME || 'arriendos360_db',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD
        });

        await cliente.connect();
        try {
            const { rows } = await cliente.query(
                `SELECT count(*)::int AS total
                   FROM financiero.cuentas_cobro
                  WHERE id_cuenta_cobro = $1`,
                [idCuentaCobro]
            );
            assert.equal(rows[0].total, 1, 'la cuenta debería estar en financiero.cuentas_cobro');

            const { rows: restos } = await cliente.query(
                "SELECT to_regclass('public.cuentas_cobro') AS c, to_regclass('public.transacciones') AS t"
            );
            assert.equal(restos[0].c, null, 'public.cuentas_cobro debería haberse retirado');
            assert.equal(restos[0].t, null, 'public.transacciones debería haberse retirado');

            // Y su bitácora de eventos procesados, que es lo que hace que una
            // reentrega no cobre dos veces.
            const { rows: bitacora } = await cliente.query(
                "SELECT to_regclass('financiero.eventos_procesados') AS tabla"
            );
            assert.notEqual(bitacora[0].tabla, null);
        } finally {
            await cliente.end();
        }
    });

    it('registrar un pago funciona de punta a punta', async () => {
        // El dinero entra por `POST /api/pagos`, con el cuerpo del Capítulo 2, y
        // desde el paso 6e la petición atraviesa la costura hasta ms-financiero.
        const transaccion = await pedir('POST', '/api/pagos', {
            token: tokenPropietario,
            cuerpo: {
                id_cuenta_cobro: idCuentaCobro,
                monto: 500000,
                tipo: 'INGRESO',
                medio_pago: 'Transferencia'
            }
        });

        assert.equal(transaccion.estado, 201);
        assert.equal(
            transaccion.datos.cuenta_cobro.estado,
            'PARCIAL',
            'debería quedar en pago parcial'
        );

        // El saldo lo calcula el servidor sumando las transacciones
        // confirmadas; que la API lo siga devolviendo con el mismo nombre es
        // parte del contrato con el frontend.
        assert.equal(transaccion.datos.cuenta_cobro.saldo_pendiente, 1000000);
    });

    it('anular la transacción devuelve el saldo y el estado', async () => {
        const transacciones = await pedir('GET', `/api/pagos/${idCuentaCobro}/transacciones`, {
            token: tokenPropietario
        });
        assert.equal(transacciones.estado, 200);

        const anulacion = await pedir(
            `POST`,
            `/api/pagos/transacciones/${transacciones.datos[0].id_transaccion}/anular`,
            { token: tokenPropietario }
        );

        assert.equal(anulacion.estado, 200, JSON.stringify(anulacion.datos));
        assert.equal(anulacion.datos.cuenta_cobro.saldo_pendiente, 1500000);
        assert.equal(anulacion.datos.cuenta_cobro.estado, 'PENDIENTE');
    });

    it('el comprobante de la transaccion sale con los datos de los tres servicios', async () => {
        // RF-18 contra el stack real, y es donde de verdad se ve si la
        // composicion funciona: el arrendatario sale de ms-identidad y el
        // inmueble de ms-inmuebles a traves de ms-contratos. Con dobles, «el PDF
        // trae la direccion» no significa nada.
        const transacciones = await pedir('GET', `/api/pagos/${idCuentaCobro}/transacciones`, {
            token: tokenPropietario
        });
        assert.equal(transacciones.estado, 200);
        assert.equal(transacciones.datos.length, 1);

        const idTransaccion = transacciones.datos[0].id_transaccion;

        const respuesta = await fetch(
            `${GATEWAY}/api/pagos/transacciones/${idTransaccion}/comprobante`,
            { headers: { Authorization: `Bearer ${tokenPropietario}` } }
        );

        assert.equal(respuesta.status, 200);
        assert.equal(respuesta.headers.get('content-type'), 'application/pdf');

        const texto = textoDelPdf(Buffer.from(await respuesta.arrayBuffer()));

        // De ms-identidad, por HTTP.
        assert.match(texto, /Inqui Lino/, 'el arrendatario lo compone ms-identidad');
        assert.match(texto, new RegExp(`Q${SELLO}`), 'con su documento');

        // De ms-inmuebles, a traves de ms-contratos con `incluir=inmueble`.
        assert.match(texto, /Calle Integraci/, 'el inmueble viaja dentro del contrato');

        // Y del propio servicio, la parte mas interesante: esta transaccion se
        // ANULO en la prueba anterior, asi que el comprobante lo dice...
        assert.match(texto, /ANULADA/);

        // ...pero SU SALDO NO SE HA MOVIDO. Cuando se emitio quedaban 1.000.000
        // por pagar; la anulacion devolvio el saldo VIGENTE de la cuenta a
        // 1.500.000, y aun asi el documento sigue diciendo 1.000.000.
        //
        // Es `saldo_restante_momento`, la unica cifra de saldo que se guarda, y
        // esta es la demostracion de por que se guarda: un comprobante ya
        // emitido no puede cambiar porque despues pase algo. Si se derivara,
        // aqui pondria 1.500.000. Ver docs/adr/0015 y docs/adr/0016.
        assert.match(texto, /1\.000\.000/, 'la foto del saldo, no el saldo de hoy');
    });

    it('el recibo mensual en PDF tambien', async () => {
        const respuesta = await fetch(`${GATEWAY}/api/pagos/${idCuentaCobro}/recibo`, {
            headers: { Authorization: `Bearer ${tokenPropietario}` }
        });

        assert.equal(respuesta.status, 200);
        assert.equal(respuesta.headers.get('content-type'), 'application/pdf');

        const texto = textoDelPdf(Buffer.from(await respuesta.arrayBuffer()));

        assert.match(texto, /ARRIENDOS 360 S\.A\.S/);
        assert.match(texto, /Inqui Lino/);
        assert.match(texto, /Enero de 2026/, 'el periodo, formateado en UTC');

        // El recibo mensual SI refleja el estado de HOY, al reves que el
        // comprobante: con la unica transaccion anulada, la cuenta volvio a
        // PENDIENTE y el saldo al importe entero. Los dos documentos dicen cosas
        // distintas sobre la misma cuenta y los dos tienen razon — uno es una
        // foto y el otro un resumen.
        assert.match(texto, /PENDIENTE/);
        assert.match(texto, /Saldo pendiente \$ 1\.500\.000/);
        assert.match(texto, /Forma de pago M/, 'sin transacciones confirmadas: «Múltiple»');
    });

    it('finalizar el contrato libera el inmueble por el mismo camino', async () => {
        // La otra mitad del ciclo. Va por evento y no por llamada síncrona por
        // coherencia: usar un mecanismo para ocupar y otro para liberar dejaría
        // media operación con garantía de entrega y la otra media sin ella. Ver
        // docs/adr/0013.
        const finalizado = await pedir('PUT', `/api/contratos/${idContrato}/finalizar`, {
            token: tokenPropietario
        });
        assert.equal(finalizado.estado, 200, JSON.stringify(finalizado.datos));

        const intervalo = Number(process.env.EVENTOS_INTERVALO_MS || 5000);

        const detalle = await esperarA(
            () => pedir('GET', `/api/inmuebles/${idInmueble}`, { token: tokenPropietario }),
            (r) => r.datos && r.datos.estado === 'disponible',
            intervalo * 3
        );

        assert.equal(detalle.datos.estado, 'disponible');
    });

    it('el logout revoca y el gateway se entera', async () => {
        const login = await pedir('POST', '/api/auth/login', {
            cuerpo: { email: `integracion_${SELLO}@test.com`, contrasena: 'Prueba123' }
        });
        const token = login.datos.token;

        assert.equal((await pedir('GET', '/api/inmuebles', { token })).estado, 200);
        assert.equal((await pedir('POST', '/api/auth/logout', { token })).estado, 200);

        // El gateway no consulta la revocación en cada petición: la lee de su
        // caché, que se refresca cada pocos segundos. Se espera a ese refresco.
        // Ver docs/adr/0008: esta ventana es la consecuencia aceptada del diseño.
        const intervalo = Number(process.env.REVOCADOS_INTERVALO_MS || 15000);
        let estado = 200;
        const limite = Date.now() + intervalo * 2 + 5000;

        while (Date.now() < limite && estado === 200) {
            await new Promise((r) => setTimeout(r, 1000));
            estado = (await pedir('GET', '/api/inmuebles', { token })).estado;
        }

        assert.equal(estado, 401, 'el token revocado debería dejar de servir tras el refresco');
    });

    after(async () => {
        if (idInmueble && tokenPropietario) {
            // No se puede borrar el inmueble con contrato activo; se deja. La
            // base de desarrollo no es un entorno limpio y esta suite no
            // pretende serlo: por eso cada ejecución usa su propio sello.
        }
    });
});

/**
 * Recuperación de contraseña de punta a punta — paso 7.
 *
 * ── POR QUE ESTE CAMINO SI ENTRA EN LA SUITE DE INTEGRACION ─────────────────
 *
 * La convención dice que aquí sólo entra lo crítico para la demostración y lo que
 * ningún doble puede tapar. Este camino cumple las dos cosas, y la segunda de forma
 * especialmente clara: recorre CUATRO servicios —el gateway, ms-identidad,
 * ms-notificaciones y otra vez ms-identidad— y el paso 7 lo partió justo por la mitad.
 *
 * Antes era una petición síncrona: `/recuperar` mandaba el correo y se sabía si había
 * salido. Ahora ms-identidad anota un evento, su publicador lo entrega,
 * ms-notificaciones resuelve el destinatario contra ms-identidad, redacta y su enviador
 * manda. Cada una de esas cuatro fronteras es un contrato que un doble podría estar
 * representando mal, y el síntoma sería el peor posible: nadie recibe el correo y no hay
 * ningún error en ninguna parte.
 *
 * La prueba mira la BASE y no un buzón, por lo mismo que la suite ya mira
 * `contratos.eventos_salida`: el correo no llega a nadie en desarrollo —Ethereal— así
 * que la única constancia comprobable de que salió es la fila de
 * `notificaciones.envios`. Y eso es, además, exactamente lo que el ADR 0019 prometía
 * que se podría comprobar.
 */
describe('Recuperación de contraseña, de punta a punta', () => {
    /** Una consulta suelta, con su propia conexión. Igual que `eventoDe`. */
    const consultar = async (sql, parametros) => {
        const cliente = new Client({
            host: process.env.DB_HOST_TEST_INTEGRACION || 'localhost',
            port: Number(process.env.DB_PORT || 5432),
            database: process.env.DB_NAME || 'arriendos360_db',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD
        });

        await cliente.connect();
        try {
            const { rows } = await cliente.query(sql, parametros);
            return rows;
        } finally {
            await cliente.end();
        }
    };

    const email = `recupera_${SELLO}@test.com`;
    let idUsuario;
    let token;

    before(async () => {
        const registro = await pedir('POST', '/api/auth/registro', {
            cuerpo: {
                nombres: 'Recu',
                apellidos: 'Pera',
                email,
                contrasena: 'Original123',
                telefono: '3001234567',
                documento: `REC${SELLO}`
            }
        });

        assert.equal(registro.estado, 201, 'el registro del caso de recuperación debería funcionar');

        const login = await pedir('POST', '/api/auth/login', {
            cuerpo: { email, contrasena: 'Original123' }
        });
        idUsuario = login.datos.usuario.id;
    });

    it('la solicitud responde prometiendo un envío FUTURO, no uno hecho', async () => {
        const respuesta = await pedir('POST', '/api/auth/recuperar', { cuerpo: { email } });

        assert.equal(respuesta.estado, 200);

        // El cambio de garantía del paso 7, en el texto que ve la persona. Con el envío
        // dentro de la petición se podía afirmar que el correo había salido; ahora sale
        // después, así que el mensaje promete el envío y no la entrega.
        assert.match(
            respuesta.datos.mensaje,
            /te enviaremos/i,
            'el mensaje debería prometer un envío futuro, porque el correo ya no sale en esta petición'
        );
    });

    it('ms-identidad anotó el evento con el token, y sin el correo', async () => {
        const filas = await consultar(
            `SELECT tipo, version, payload, estado
               FROM identidad.eventos_salida
              WHERE payload->>'id_usuario' = $1 AND tipo = 'RecuperacionSolicitada'`,
            [idUsuario]
        );

        assert.equal(filas.length, 1, 'debería haber UN RecuperacionSolicitada para este usuario');

        // Que esté en `identidad` y no en otro esquema es parte de lo que se comprueba:
        // la tabla de salida es del productor, y el productor de este evento es
        // ms-identidad. Si apareciera en otro sitio, el productor sería otro.
        const evento = filas[0];
        assert.ok(evento.payload.token, 'el sobre debería llevar el token');

        // Y NO lleva la dirección de correo: pertenece a identidad.usuarios y a nadie
        // más. Si el emisor la copiara aquí, se convertiría en responsable de un dato de
        // contacto que no le pertenece.
        assert.equal(evento.payload.email, undefined, 'el sobre NO debe llevar el correo');
        assert.ok(
            !JSON.stringify(evento.payload).includes(email),
            'el sobre NO debe llevar la dirección de correo de nadie'
        );

        token = evento.payload.token;
    });

    it('ms-notificaciones lo recibió, resolvió el destinatario y lo envió', async () => {
        // Aquí está la ventana del bus: el publicador barre cada pocos segundos y el
        // enviador otro tanto, así que se espera a que convergía en vez de afirmarlo. Es
        // la misma razón por la que el estado del inmueble se comprueba con `esperarA`.
        const intervalo = Number(process.env.EVENTOS_INTERVALO_MS || 5000);
        const envios = Number(process.env.ENVIOS_INTERVALO_MS || 5000);

        const filas = await esperarA(
            () =>
                consultar(
                    `SELECT e.estado, e.destinatario, e.id_usuario, e.asunto, e.cuerpo, e.tipo_evento
                       FROM notificaciones.envios e
                      WHERE e.id_usuario = $1 AND e.tipo_evento = 'RecuperacionSolicitada'`,
                    [idUsuario]
                ),
            (filas) => filas.length === 1 && filas[0].estado === 'enviado',
            intervalo * 2 + envios * 2 + 10000
        );

        assert.equal(filas.length, 1, 'debería haber UN envío para este usuario');
        const envio = filas[0];

        assert.equal(envio.estado, 'enviado', 'el envío debería haber salido');

        // EL DESTINATARIO SE RESOLVIO CONTRA MS-IDENTIDAD. El sobre no lo llevaba, así
        // que esta dirección sólo puede venir de haberla preguntado. Es la comprobación
        // que ningún doble puede dar por buena: si el contrato de `/interno/usuarios`
        // cambiara, aquí no habría correo y las suites de cada servicio seguirían verdes.
        assert.equal(envio.destinatario, email);

        // Y EL CUERPO SE BORRO AL ENVIAR. El correo llevaba un enlace con el token en
        // claro; conservarlo en la bitácora para siempre sería dejar la llave debajo del
        // felpudo. Lo que queda es a quién, cuándo y con qué asunto.
        assert.equal(envio.cuerpo, null, 'el cuerpo debería borrarse al marcar el envío');
        assert.ok(envio.asunto.length > 0);
    });

    it('y el payload del evento se borró al entregarlo', async () => {
        // La otra mitad de la misma decisión, en la otra tabla. El token en claro no
        // puede quedarse en `identidad.eventos_salida` después de entregado, porque
        // `identidad.tokens_recuperacion` guarda sólo su SHA-256 precisamente para que
        // leer una tabla no permita restablecer la contraseña de nadie.
        const filas = await esperarA(
            () =>
                consultar(
                    `SELECT estado, payload
                       FROM identidad.eventos_salida
                      WHERE payload->>'id_usuario' = $1 OR (estado = 'entregado' AND tipo = 'RecuperacionSolicitada')`,
                    [idUsuario]
                ),
            (filas) => filas.some((f) => f.estado === 'entregado'),
            Number(process.env.EVENTOS_INTERVALO_MS || 5000) * 3 + 10000
        );

        const entregados = filas.filter((f) => f.estado === 'entregado');
        assert.ok(entregados.length > 0, 'el evento debería estar entregado');

        for (const fila of entregados) {
            assert.deepEqual(
                fila.payload,
                {},
                'un RecuperacionSolicitada entregado no debe conservar su token'
            );
        }
    });

    it('el enlace del correo restablece la contraseña de verdad', async () => {
        // El cierre del camino: el token que viajó por el bus sirve para restablecer, y
        // la contraseña nueva sirve para entrar. Sin esto, todo lo anterior podría estar
        // moviendo un token que no vale para nada.
        const restablecer = await pedir('POST', '/api/auth/restablecer', {
            cuerpo: { token, contrasena_nueva: 'Restablecida456' }
        });

        assert.equal(restablecer.estado, 200);
        // No devuelve token: el enlace del correo no es un acceso directo a la cuenta.
        assert.equal(restablecer.datos.token, undefined);

        const conLaNueva = await pedir('POST', '/api/auth/login', {
            cuerpo: { email, contrasena: 'Restablecida456' }
        });
        assert.equal(conLaNueva.estado, 200);

        // Y la vieja dejó de valer.
        const conLaVieja = await pedir('POST', '/api/auth/login', {
            cuerpo: { email, contrasena: 'Original123' }
        });
        assert.equal(conLaVieja.estado, 401);
    });

    it('el enlace es de un solo uso, también después de pasar por el bus', async () => {
        const segunda = await pedir('POST', '/api/auth/restablecer', {
            cuerpo: { token, contrasena_nueva: 'OtraVezNo789' }
        });

        assert.equal(segunda.estado, 400);
    });
});
