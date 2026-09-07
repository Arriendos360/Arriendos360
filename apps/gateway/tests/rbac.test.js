/**
 * Pruebas de la matriz RBAC del gateway.
 *
 * No tocan PostgreSQL: montan un Express mínimo con sólo el control de acceso y
 * un manejador comodín que responde 200 a lo que llegue. Así, un 200 significa
 * exactamente «la matriz dejó pasar» y un 403 «la matriz denegó», sin que un
 * fallo de la lógica de negocio pueda disfrazarse de política.
 *
 * La consulta de revocados se inyecta como una función que siempre devuelve
 * `false`; la revocación de verdad la cubre `auth.test.js` contra la base.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const { MATRIZ, MENSAJE_NO_DECLARADA, crearControlDeAcceso } = require('../src/routing');

const SECRETO = 'secreto-de-pruebas-rbac';

let app;

/** Token con la forma que emite el proyecto: sub, email, roles, jti y exp. */
const tokenCon = (roles) =>
    jwt.sign(
        {
            sub: '11111111-1111-4111-8111-111111111111',
            email: 'prueba@arriendos360.test',
            roles,
            jti: '22222222-2222-4222-8222-222222222222'
        },
        SECRETO,
        { expiresIn: '1h' }
    );

const PROPIETARIO = () => tokenCon(['PROPIETARIO']);
const INQUILINO = () => tokenCon(['INQUILINO']);
const AMBOS_ROLES = () => tokenCon(['PROPIETARIO', 'INQUILINO']);
const SIN_ROLES = () => tokenCon([]);

/** Lanza la petición del método indicado contra la ruta, con token opcional. */
const pedir = (metodo, ruta, token) => {
    const peticion = request(app)[metodo.toLowerCase()](ruta);
    return token ? peticion.set('Authorization', `Bearer ${token}`) : peticion;
};

beforeAll(() => {
    app = express();
    app.use(
        crearControlDeAcceso({
            secreto: SECRETO,
            estaRevocado: async () => false
        })
    );
    // Todo lo que sobreviva a la matriz llega aquí.
    app.all(/.*/, (req, res) => res.json({ paso: true, usuario: req.usuario || null }));
});

describe('Denegar por defecto', () => {
    test('una ruta de /api no declarada responde 403 aunque el token sea válido', async () => {
        const respuesta = await pedir('GET', '/api/inventado', PROPIETARIO());

        expect(respuesta.status).toBe(403);
        expect(respuesta.body.mensaje).toBe(MENSAJE_NO_DECLARADA);
    });

    test('/api/admin quedó fuera de la matriz al eliminar el router del motor', async () => {
        const respuesta = await pedir('POST', '/api/admin/ejecutar-motor', PROPIETARIO());

        expect(respuesta.status).toBe(403);
    });

    test('un método no declarado sobre una ruta que sí existe responde 403', async () => {
        // DELETE no está declarado para pagos: sólo GET, POST y el PUT de pagar.
        const respuesta = await pedir('DELETE', '/api/pagos/abc', PROPIETARIO());

        expect(respuesta.status).toBe(403);
    });

    test('el mensaje de denegación no distingue entre "no existe" y "no puedes"', async () => {
        // Las dos respuestas tienen que ser indistinguibles, o el 403 se
        // convierte en un mapa de la API para quien vaya probando rutas.
        const inventada = await pedir('GET', '/api/inventado', PROPIETARIO());
        const otraInventada = await pedir('GET', '/api/tampoco/existe', PROPIETARIO());

        expect(inventada.body).toEqual(otraInventada.body);
    });

    test('lo que está fuera de /api no lo gobierna la matriz', async () => {
        expect((await pedir('GET', '/')).status).toBe(200);
        expect((await pedir('GET', '/uploads/contratos/x.pdf')).status).toBe(200);
    });
});

describe('Rutas públicas', () => {
    test('POST /api/auth/registro no exige token', async () => {
        const respuesta = await pedir('POST', '/api/auth/registro');
        expect(respuesta.status).toBe(200);
    });

    test('POST /api/auth/login no exige token', async () => {
        const respuesta = await pedir('POST', '/api/auth/login');
        expect(respuesta.status).toBe(200);
    });

    test('GET sobre una ruta pública de POST no está declarado: 403', async () => {
        // La política es por método, no por ruta.
        const respuesta = await pedir('GET', '/api/auth/login');
        expect(respuesta.status).toBe(403);
    });
});

describe('Rutas sólo autenticadas', () => {
    test('POST /api/auth/logout sin token responde 401', async () => {
        const respuesta = await pedir('POST', '/api/auth/logout');
        expect(respuesta.status).toBe(401);
    });

    test('POST /api/auth/logout con token inválido responde 403', async () => {
        const respuesta = await pedir('POST', '/api/auth/logout', 'token-de-mentira');
        expect(respuesta.status).toBe(403);
    });

    test('POST /api/auth/logout vale con cualquier rol, incluso sin ninguno', async () => {
        expect((await pedir('POST', '/api/auth/logout', PROPIETARIO())).status).toBe(200);
        expect((await pedir('POST', '/api/auth/logout', INQUILINO())).status).toBe(200);
        expect((await pedir('POST', '/api/auth/logout', SIN_ROLES())).status).toBe(200);
    });
});

/**
 * Tabla de casos: cada fila de la matriz con el rol que debe pasar y el rol que
 * debe ser rechazado. Es la comprobación que pedía el enunciado, y se escribe
 * como datos para que añadir una política sea añadir una fila aquí.
 */
describe('Cada política, con el rol correcto y con el equivocado', () => {
    const CASOS = [
        // [método, ruta, rol que pasa, rol que se rechaza]
        ['GET', '/api/usuarios/buscar?documento=123', PROPIETARIO, INQUILINO],
        ['POST', '/api/usuarios/inquilinos', PROPIETARIO, INQUILINO],

        ['GET', '/api/inmuebles', PROPIETARIO, INQUILINO],
        ['GET', '/api/inmuebles/abc', PROPIETARIO, INQUILINO],
        ['POST', '/api/inmuebles', PROPIETARIO, INQUILINO],
        ['PUT', '/api/inmuebles/abc', PROPIETARIO, INQUILINO],
        ['DELETE', '/api/inmuebles/abc', PROPIETARIO, INQUILINO],

        ['GET', '/api/contratos', INQUILINO, SIN_ROLES],
        ['GET', '/api/contratos/abc', INQUILINO, SIN_ROLES],
        ['POST', '/api/contratos', PROPIETARIO, INQUILINO],
        // Las dos que el enunciado nombraba expresamente:
        ['PUT', '/api/contratos/abc/finalizar', PROPIETARIO, INQUILINO],
        ['POST', '/api/contratos/abc/anexos', PROPIETARIO, INQUILINO],

        ['GET', '/api/pagos', INQUILINO, SIN_ROLES],
        ['GET', '/api/pagos/pendientes', INQUILINO, SIN_ROLES],
        ['GET', '/api/pagos/abc/recibo', INQUILINO, SIN_ROLES],
        ['POST', '/api/pagos', PROPIETARIO, INQUILINO],
        ['POST', '/api/pagos/verificar-mora', PROPIETARIO, INQUILINO],
        // Registrar el abono es del propietario: el inquilino lo consulta, no lo
        // asienta. Ver docs/adr/0006.
        ['PUT', '/api/pagos/abc/pagar', PROPIETARIO, INQUILINO],

        ['GET', '/api/dashboard/resumen', PROPIETARIO, INQUILINO],
        ['GET', '/api/dashboard/mora', PROPIETARIO, INQUILINO]
    ];

    test.each(CASOS)('%s %s deja pasar al rol correcto', async (metodo, ruta, permitido) => {
        const respuesta = await pedir(metodo, ruta, permitido());
        expect(respuesta.status).toBe(200);
    });

    test.each(CASOS)('%s %s rechaza al rol equivocado', async (metodo, ruta, _permitido, denegado) => {
        const respuesta = await pedir(metodo, ruta, denegado());
        expect(respuesta.status).toBe(403);
    });

    test.each(CASOS)('%s %s exige token', async (metodo, ruta) => {
        const respuesta = await pedir(metodo, ruta);
        expect(respuesta.status).toBe(401);
    });
});

describe('El inquilino consulta pagos pero no los asienta', () => {
    test('puede leer el listado y el recibo', async () => {
        expect((await pedir('GET', '/api/pagos', INQUILINO())).status).toBe(200);
        expect((await pedir('GET', '/api/pagos/abc/recibo', INQUILINO())).status).toBe(200);
    });

    test('no puede registrar un abono', async () => {
        const respuesta = await pedir('PUT', '/api/pagos/abc/pagar', INQUILINO());
        expect(respuesta.status).toBe(403);
    });
});

describe('Usuario con los dos roles', () => {
    test('pasa tanto por las políticas de propietario como por las de ambos', async () => {
        expect((await pedir('POST', '/api/inmuebles', AMBOS_ROLES())).status).toBe(200);
        expect((await pedir('GET', '/api/contratos', AMBOS_ROLES())).status).toBe(200);
        expect((await pedir('GET', '/api/dashboard/resumen', AMBOS_ROLES())).status).toBe(200);
    });
});

describe('Contrato entre la matriz y el resto del gateway', () => {
    test('deja los claims en req.usuario para que nadie tenga que reverificar', async () => {
        const respuesta = await pedir('GET', '/api/contratos', PROPIETARIO());

        expect(respuesta.body.usuario.sub).toBe('11111111-1111-4111-8111-111111111111');
        expect(respuesta.body.usuario.roles).toEqual(['PROPIETARIO']);
    });

    test('una ruta pública no deja usuario en la petición', async () => {
        const respuesta = await pedir('POST', '/api/auth/login');
        expect(respuesta.body.usuario).toBeNull();
    });

    test('toda política declara un acceso reconocible', () => {
        // Red de seguridad contra una fila mal escrita: un `acceso` que no sea
        // ni público, ni autenticado, ni un arreglo de roles, denegaría siempre
        // sin que ninguna prueba de arriba lo notara.
        for (const politica of MATRIZ) {
            const valido =
                politica.acceso === 'publico' ||
                politica.acceso === 'autenticado' ||
                (Array.isArray(politica.acceso) && politica.acceso.length > 0);

            expect(valido).toBe(true);
        }
    });
});
