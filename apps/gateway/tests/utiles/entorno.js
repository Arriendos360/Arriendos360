/**
 * Utilidades comunes de las pruebas del gateway.
 *
 * Cambio importante desde que se extrajo ms-identidad: `/api/auth` y
 * `/api/usuarios` ya no los sirve el gateway, así que las suites no pueden crear
 * usuarios contra el `app` en proceso. Se levanta un DOBLE del servicio
 * (`tests/dobles/identidad.js`) y se apunta `MS_IDENTIDAD_URL` a él; la costura
 * reenvía igual que en producción, sólo que al otro extremo hay un servidor de
 * mentira con usuarios en memoria.
 *
 * Consecuencia práctica: `prepararEntorno()` tiene que llamarse ANTES de la
 * primera petición, y `cerrarEntorno()` al final para no dejar el puerto abierto.
 */

const request = require('supertest');

const app = require('../../src/app');
const { sequelize } = require('../../src/config/database');
const { recrearEsquema } = require('../../src/database/migraciones');
const { crearIdentidadFalsa } = require('../dobles/identidad');

const CONTRASENA_POR_DEFECTO = 'pass123';

/** El doble activo. Lo comparten los helpers de este módulo. */
let identidad = null;

/**
 * Levanta el doble de identidad, lo cablea y deja el esquema del gateway limpio.
 *
 * @returns {Promise<object>} el doble, por si la prueba necesita manipularlo.
 */
const prepararEntorno = async () => {
    identidad = await crearIdentidadFalsa();
    // La costura lee `process.env` en cada petición, así que basta con ponerlo.
    process.env.MS_IDENTIDAD_URL = identidad.url;

    await recrearEsquema(sequelize);
    return identidad;
};

const cerrarEntorno = async () => {
    if (identidad) {
        await identidad.cerrar();
        identidad = null;
    }
    delete process.env.MS_IDENTIDAD_URL;
    await sequelize.close();
};

/** El doble en curso, para pruebas que necesiten inspeccionarlo. */
const identidadFalsa = () => identidad;

/**
 * Registra un propietario y devuelve su token y su UUID.
 *
 * Va contra el gateway, no contra el doble: así la petición atraviesa la matriz
 * RBAC y la costura, que es justo lo que interesa ejercitar.
 */
const registrarPropietario = async (datos) => {
    const cuerpo = { contrasena: CONTRASENA_POR_DEFECTO, telefono: '3000000000', ...datos };

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

/** Da de alta un inquilino con el token de un propietario. */
const crearInquilino = async (tokenPropietario, datos) => {
    const cuerpo = { contrasena: CONTRASENA_POR_DEFECTO, telefono: '3000000001', ...datos };

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

const iniciarSesion = (email, contrasena = CONTRASENA_POR_DEFECTO) =>
    request(app).post('/api/auth/login').send({ email, contrasena });

/** Cabecera de autorización lista para `.set(...)`. */
const conToken = (token) => ['Authorization', `Bearer ${token}`];

module.exports = {
    CONTRASENA_POR_DEFECTO,
    app,
    cerrarEntorno,
    conToken,
    crearInquilino,
    identidadFalsa,
    iniciarSesion,
    prepararEntorno,
    registrarPropietario,
    sequelize
};
