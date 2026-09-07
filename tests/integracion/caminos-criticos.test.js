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
 * algo que sólo hace peticiones HTTP y comprueba respuestas.
 */

const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');

const GATEWAY = process.env.URL_GATEWAY || 'http://localhost:3001';
const IDENTIDAD = process.env.URL_IDENTIDAD || 'http://localhost:3011';

/** Sufijo único por ejecución: la suite corre contra una base que no se resetea. */
const SELLO = Date.now().toString().slice(-9);

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

let tokenPropietario;
let idInquilino;
let idInmueble;
let idContrato;
let idPago;

describe('Caminos críticos', () => {
    before(async () => {
        // Falla pronto y con un mensaje útil si el stack no está en pie: es el
        // error más probable de esta suite y el más confuso si no se explica.
        for (const [nombre, url] of [
            ['gateway', `${GATEWAY}/`],
            ['ms-identidad', `${IDENTIDAD}/`]
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
                tipo_inmueble: 'Apartamento'
            }
        });
        assert.equal(inmueble.estado, 201);
        idInmueble = inmueble.datos.inmueble.id_inmueble;

        const contrato = await pedir('POST', '/api/contratos', {
            token: tokenPropietario,
            cuerpo: {
                id_inmueble: idInmueble,
                id_inquilino: idInquilino,
                fecha_inicio: '2026-01-01',
                fecha_fin: '2026-12-31',
                valor_mensual: 1500000
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
    });

    it('registrar un pago funciona de punta a punta', async () => {
        const pago = await pedir('POST', '/api/pagos', {
            token: tokenPropietario,
            cuerpo: {
                id_contrato: idContrato,
                monto_total: 1500000,
                mes_correspondiente: '2026-01-01'
            }
        });
        assert.equal(pago.estado, 201);
        idPago = pago.datos.pago.id_pago;

        const abono = await pedir('PUT', `/api/pagos/${idPago}/pagar`, {
            token: tokenPropietario,
            cuerpo: { monto_pagado: 500000, tipo_transaccion: 'Transferencia' }
        });

        assert.equal(abono.estado, 200);
        assert.equal(abono.datos.pago.estado, 4, 'debería quedar en pago parcial');
    });

    it('el recibo en PDF compone al arrendatario', async () => {
        const respuesta = await fetch(`${GATEWAY}/api/pagos/${idPago}/recibo`, {
            headers: { Authorization: `Bearer ${tokenPropietario}` }
        });

        assert.equal(respuesta.status, 200);
        assert.equal(respuesta.headers.get('content-type'), 'application/pdf');
        assert.ok((await respuesta.arrayBuffer()).byteLength > 1000);
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
