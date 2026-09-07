/**
 * Cierre de sesión y revocación de tokens.
 *
 * Es la parte del módulo de seguridad que no existía antes de este paso: un
 * token firmado y vigente valía hasta que expirara solo, así que cerrar sesión
 * era un gesto puramente del navegador. Ahora `jti` viaja en los claims y
 * `TokensRevocados` lo invalida del lado del servidor.
 */

const jwt = require('jsonwebtoken');
const request = require('supertest');

const {
    app,
    cerrarBase,
    conToken,
    crearInquilino,
    iniciarSesion,
    recrearBase,
    registrarPropietario
} = require('./utiles/entorno');
const { ROLES, USUARIO_SISTEMA } = require('../src/models/constantes');
const RolUsuario = require('../src/models/RolUsuario');
const TokenRevocado = require('../src/models/TokenRevocado');

let propietario;

beforeAll(async () => {
    await recrearBase();

    propietario = await registrarPropietario({
        email: 'logout@test.com',
        nombres: 'Cierra',
        apellidos: 'Sesion',
        documento: '4001'
    });
});

afterAll(async () => {
    await cerrarBase();
});

describe('Claims del token', () => {
    test('Lleva sub, email, roles, jti y exp a una hora', () => {
        const claims = jwt.decode(propietario.token);

        expect(claims.sub).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
        expect(claims.email).toBe('logout@test.com');
        expect(claims.roles).toEqual(['PROPIETARIO']);
        expect(claims.jti).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
        expect(claims.exp - claims.iat).toBe(3600);
    });

    test('Ya no lleva id_perfil', () => {
        const claims = jwt.decode(propietario.token);
        expect(claims.id_perfil).toBeUndefined();
        expect(claims.rol).toBeUndefined();
    });
});

describe('POST /api/auth/logout', () => {
    test('Sin token responde 401', async () => {
        const response = await request(app).post('/api/auth/logout');
        expect(response.statusCode).toBe(401);
    });

    test('Cierra la sesión y anota el jti en TokensRevocados', async () => {
        const sesion = await iniciarSesion('logout@test.com');
        const claims = jwt.decode(sesion.body.token);

        const response = await request(app)
            .post('/api/auth/logout')
            .set(...conToken(sesion.body.token));

        expect(response.statusCode).toBe(200);
        expect(response.body.mensaje).toBe('Sesión cerrada');

        const revocado = await TokenRevocado.findByPk(claims.jti);
        expect(revocado).not.toBeNull();
        // La fila caduca cuando caduca el token: por eso no hace falta barrido.
        expect(Math.round(revocado.expira_en.getTime() / 1000)).toBe(claims.exp);
    });

    test('Es idempotente: cerrar sesión dos veces no falla', async () => {
        const sesion = await iniciarSesion('logout@test.com');

        const primera = await request(app)
            .post('/api/auth/logout')
            .set(...conToken(sesion.body.token));
        expect(primera.statusCode).toBe(200);

        // El segundo intento ya llega con el token revocado, así que lo corta el
        // middleware antes que el controlador.
        const segunda = await request(app)
            .post('/api/auth/logout')
            .set(...conToken(sesion.body.token));
        expect(segunda.statusCode).toBe(401);
    });
});

describe('Token revocado', () => {
    test('Un token revocado deja de servir aunque la firma siga siendo válida', async () => {
        const sesion = await iniciarSesion('logout@test.com');
        const token = sesion.body.token;

        // Antes de cerrar sesión funciona.
        const antes = await request(app).get('/api/inmuebles').set(...conToken(token));
        expect(antes.statusCode).toBe(200);

        await request(app).post('/api/auth/logout').set(...conToken(token));

        // La firma sigue verificando: lo que cambió es la lista de revocados.
        expect(() => jwt.verify(token, process.env.JWT_SECRET)).not.toThrow();

        const despues = await request(app).get('/api/inmuebles').set(...conToken(token));
        expect(despues.statusCode).toBe(401);
        expect(despues.body.mensaje).toContain('Sesión cerrada');
    });

    test('Revocar una sesión no afecta a las demás sesiones del mismo usuario', async () => {
        const movil = await iniciarSesion('logout@test.com');
        const escritorio = await iniciarSesion('logout@test.com');

        await request(app).post('/api/auth/logout').set(...conToken(movil.body.token));

        const respuesta = await request(app)
            .get('/api/inmuebles')
            .set(...conToken(escritorio.body.token));

        expect(respuesta.statusCode).toBe(200);
    });

    test('Una revocación ya vencida deja de tener efecto', async () => {
        // Es lo que hace innecesario el barrido programado: la consulta filtra
        // por `expira_en > NOW()`, así que una fila del pasado no bloquea nada.
        const sesion = await iniciarSesion('logout@test.com');
        const claims = jwt.decode(sesion.body.token);

        await TokenRevocado.create({
            jti: claims.jti,
            expira_en: new Date(Date.now() - 60 * 1000)
        });

        const respuesta = await request(app)
            .get('/api/inmuebles')
            .set(...conToken(sesion.body.token));

        expect(respuesta.statusCode).toBe(200);
    });

    test('Un token sin jti se rechaza: es de la forma anterior al paso 3a', async () => {
        const antiguo = jwt.sign(
            { id: 1, correo: 'logout@test.com', rol: 'propietario', id_perfil: '4001' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const respuesta = await request(app).get('/api/inmuebles').set(...conToken(antiguo));

        expect(respuesta.statusCode).toBe(403);
        expect(respuesta.body.mensaje).toContain('Token no válido');
    });
});

describe('Roles múltiples', () => {
    test('Un usuario con los dos roles los lleva ambos en los claims', async () => {
        const doble = await registrarPropietario({
            email: 'ambos@test.com',
            nombres: 'Carmen',
            apellidos: 'Ambos',
            documento: '4002'
        });

        // Se le añade el segundo rol directamente: no hay endpoint para promover
        // usuarios, y no toca inventarlo en este paso.
        await RolUsuario.create(
            {
                id_rol: ROLES.INQUILINO,
                id_usuario: doble.id,
                creado_por: USUARIO_SISTEMA
            },
            { usuarioAuditor: USUARIO_SISTEMA }
        );

        const sesion = await iniciarSesion('ambos@test.com');
        const claims = jwt.decode(sesion.body.token);

        expect(claims.roles.sort()).toEqual(['INQUILINO', 'PROPIETARIO']);
        // El rol singular de la respuesta es el principal, no una contradicción.
        expect(sesion.body.usuario.rol).toBe('PROPIETARIO');
    });
});

describe('Alta de inquilinos y búsqueda por documento', () => {
    test('Un inquilino no puede dar de alta a otro usuario', async () => {
        const inquilino = await crearInquilino(propietario.token, {
            email: 'inq_alta@test.com',
            nombres: 'Inq',
            apellidos: 'Alta',
            documento: '4003'
        });
        expect(inquilino.respuesta.statusCode).toBe(201);

        const sesion = await iniciarSesion('inq_alta@test.com');
        const intento = await request(app)
            .post('/api/usuarios/inquilinos')
            .set(...conToken(sesion.body.token))
            .send({
                email: 'otro@test.com',
                contrasena: 'pass123',
                nombres: 'Otro',
                apellidos: 'Usuario',
                documento: '4004'
            });

        expect(intento.statusCode).toBe(403);
    });

    test('La búsqueda por documento devuelve el UUID que necesita el contrato', async () => {
        const respuesta = await request(app)
            .get('/api/usuarios/buscar?documento=4003')
            .set(...conToken(propietario.token));

        expect(respuesta.statusCode).toBe(200);
        expect(respuesta.body.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
        expect(respuesta.body.nombres).toBe('Inq');
        // No expone datos de contacto de terceros.
        expect(respuesta.body.email).toBeUndefined();
        expect(respuesta.body.telefono).toBeUndefined();
    });

    test('Un documento inexistente responde 404', async () => {
        const respuesta = await request(app)
            .get('/api/usuarios/buscar?documento=00000000')
            .set(...conToken(propietario.token));

        expect(respuesta.statusCode).toBe(404);
    });
});
