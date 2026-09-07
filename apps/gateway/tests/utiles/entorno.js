/**
 * Utilidades comunes de las pruebas de integración.
 *
 * Las seis suites originales empezaban con `sequelize.sync({ force: true })` y
 * un bloque copiado de registro + login. `sync()` ya no existe (lo reemplazaron
 * las migraciones versionadas) y el registro cambió de contrato, así que ese
 * bloque se centraliza aquí en vez de repetirse seis veces con seis variantes.
 *
 * Nada de esto toca la base de desarrollo: `recrearBase()` delega en
 * `recrearEsquema()`, que sólo funciona con NODE_ENV=test.
 */

const request = require('supertest');

const app = require('../../src/app');
const { sequelize } = require('../../src/config/database');
const { recrearEsquema } = require('../../src/database/migraciones');

const CONTRASENA_POR_DEFECTO = 'pass123';

/** Deja la base vacía y con el esquema recién migrado. */
const recrearBase = () => recrearEsquema(sequelize);

const cerrarBase = () => sequelize.close();

/**
 * Registra un propietario y devuelve su token y su UUID.
 *
 * El registro público siempre crea PROPIETARIO: el contrato de interfaz del
 * Capítulo 2 no lleva campo `rol`.
 */
const registrarPropietario = async (datos) => {
    const cuerpo = {
        contrasena: CONTRASENA_POR_DEFECTO,
        telefono: '3000000000',
        ...datos
    };

    const registro = await request(app).post('/api/auth/registro').send(cuerpo);

    const login = await request(app)
        .post('/api/auth/login')
        .send({ email: cuerpo.email, contrasena: cuerpo.contrasena });

    return {
        registro,
        login,
        token: login.body.token,
        id: login.body.usuario ? login.body.usuario.id : undefined,
        email: cuerpo.email,
        documento: cuerpo.documento
    };
};

/**
 * Da de alta un inquilino. Requiere el token de un propietario: dar de alta
 * usuarios dejó de ser una operación pública cuando el registro se fijó a
 * PROPIETARIO.
 *
 * Devuelve el UUID, que es lo que `Contratos.id_inquilino` guarda ahora. Antes
 * se usaba la cédula directamente.
 */
const crearInquilino = async (tokenPropietario, datos) => {
    const cuerpo = {
        contrasena: CONTRASENA_POR_DEFECTO,
        telefono: '3000000001',
        ...datos
    };

    const respuesta = await request(app)
        .post('/api/usuarios/inquilinos')
        .set('Authorization', `Bearer ${tokenPropietario}`)
        .send(cuerpo);

    return {
        respuesta,
        id: respuesta.body.usuario ? respuesta.body.usuario.id : undefined,
        email: cuerpo.email,
        documento: cuerpo.documento
    };
};

/** Inicia sesión y devuelve la respuesta completa. */
const iniciarSesion = (email, contrasena = CONTRASENA_POR_DEFECTO) =>
    request(app).post('/api/auth/login').send({ email, contrasena });

/** Cabecera de autorización lista para `.set(...)`. */
const conToken = (token) => ['Authorization', `Bearer ${token}`];

module.exports = {
    CONTRASENA_POR_DEFECTO,
    app,
    cerrarBase,
    conToken,
    crearInquilino,
    iniciarSesion,
    recrearBase,
    registrarPropietario,
    sequelize
};
