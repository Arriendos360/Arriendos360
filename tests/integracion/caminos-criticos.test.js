/**
 * Integración: los caminos críticos contra el stack real.
 *
 * Esta suite es la contrapartida de los dobles. Cada servicio prueba su lógica
 * contra dobles, rápido y sin levantar nada; eso deja un hueco que ningún doble
 * puede tapar: **que el contrato entre los dos sea cierto**. Un doble que se
 * desvía del servicio real deja las suites en verde y el sistema roto.
 *
 * Por eso es corta y sólo recorre lo que no puede fallar en una demostración:
 * entrar, firmar un contrato y registrar un pago. No duplica cobertura de casos
 * borde; para eso están las suites de cada servicio.
 *
 * Requiere el stack levantado:
 *
 *   docker compose -f infra/docker-compose.yml up --build -d
 *   npm run test:integracion
 *
 * Usa el runner de Node (`node --test`), no jest: cero dependencias nuevas para
 * algo que casi sólo hace peticiones HTTP y comprueba respuestas.
 *
 * EL «CASI» ES LA TABLA DE SALIDA. Desde el paso 6a hay una comprobación que no
 * se puede hacer por HTTP: qué lleva dentro el evento que emite el gateway. El
 * sobre no aparece en ninguna respuesta —viaja del gateway a ms-inmuebles por
 * la red interna— así que la única forma de verlo es leer `eventos_salida`.
 *
 * DESDE EL PASO 6d ESA TABLA ES DE ms-contratos, y eso es parte de lo que esta
 * consulta comprueba: si el evento apareciera en `public`, el productor seguiría
 * siendo el gateway y la extracción no estaría hecha.
 * Se usa `pg`, que ya es dependencia del gateway: no entra nada nuevo.
 */

const path = require('node:path');
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { Client } = require('pg');

// Las credenciales son las del gateway: es su base y su tabla de salida.
require('dotenv').config({ path: path.resolve(__dirname, '../../apps/gateway/.env') });

const GATEWAY = process.env.URL_GATEWAY || 'http://localhost:3001';
const IDENTIDAD = process.env.URL_IDENTIDAD || 'http://localhost:3011';
const INMUEBLES = process.env.URL_INMUEBLES || 'http://localhost:3012';

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
            ['ms-inmuebles', `${INMUEBLES}/`]
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
        assert.equal(sobre.version, 1);

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

    it('registrar un pago funciona de punta a punta', async () => {
        // Desde el paso 6c son dos recursos distintos: la cuenta de cobro se
        // emite en `/cuentas-cobro` y el dinero entra por `POST /api/pagos`,
        // con el cuerpo del Capítulo 2.
        const cuenta = await pedir('POST', '/api/pagos/cuentas-cobro', {
            token: tokenPropietario,
            cuerpo: {
                id_contrato: idContrato,
                valor: 1500000,
                inicio: '2026-01-01'
            }
        });
        assert.equal(cuenta.estado, 201);
        idCuentaCobro = cuenta.datos.cuenta_cobro.id_cuenta_cobro;

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

    it('el recibo en PDF compone al arrendatario', async () => {
        const respuesta = await fetch(`${GATEWAY}/api/pagos/${idCuentaCobro}/recibo`, {
            headers: { Authorization: `Bearer ${tokenPropietario}` }
        });

        assert.equal(respuesta.status, 200);
        assert.equal(respuesta.headers.get('content-type'), 'application/pdf');
        assert.ok((await respuesta.arrayBuffer()).byteLength > 1000);
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
