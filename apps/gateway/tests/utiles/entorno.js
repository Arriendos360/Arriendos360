/**
 * Utilidades comunes de las pruebas del gateway.
 *
 * Cambio importante desde que se extrajeron ms-identidad y ms-inmuebles:
 * `/api/auth`, `/api/usuarios` e `/api/inmuebles` ya no los sirve el gateway,
 * así que las suites no pueden crear usuarios ni inmuebles contra el `app` en
 * proceso. Se levanta un DOBLE de cada servicio (`tests/dobles/`) y se apuntan
 * `MS_IDENTIDAD_URL` y `MS_INMUEBLES_URL` a ellos; la costura reenvía igual que
 * en producción, sólo que al otro extremo hay un servidor de mentira con estado
 * en memoria.
 *
 * Consecuencia práctica: `prepararEntorno()` tiene que llamarse ANTES de la
 * primera petición, y `cerrarEntorno()` al final para no dejar el puerto abierto.
 */

const request = require('supertest');

const app = require('../../src/app');
const { sequelize } = require('../../src/config/database');
const { almacen, crearPublicadorDeSalida } = require('../../src/eventos');
const { recrearEsquema } = require('../../src/database/migraciones');
const { crearIdentidadFalsa } = require('../dobles/identidad');
const { crearInmueblesFalso } = require('../dobles/inmuebles');

const CONTRASENA_POR_DEFECTO = 'pass123';

/** Los dobles activos. Los comparten los helpers de este módulo. */
let identidad = null;
let inmuebles = null;

/**
 * El publicador de las pruebas.
 *
 * Usa el almacén y la entrega REALES —la tabla de salida de verdad y un POST de
 * verdad al doble— y sólo cambia dos cosas: no espera entre reintentos y no
 * escribe en la consola. Sin lo primero, comprobar que un evento se reintenta
 * exigiría dormir dos segundos en mitad de una suite.
 *
 * Y no se arranca nunca: las entregas ocurren cuando la prueba llama a
 * `entregarEventos()`, no cuando salta un temporizador. Es lo que hace que
 * «todavía no se ha entregado» sea una afirmación comprobable y no una carrera.
 */
const publicador = crearPublicadorDeSalida({ esperaBaseMs: 0, registrar: () => {} });

/**
 * Corre un barrido del publicador: entrega lo pendiente de la tabla de salida.
 *
 * @returns {Promise<object>} el recuento del ciclo (entregados, fallidos, ...).
 */
const entregarEventos = () => publicador.ciclo();

/** Lo que hay en la tabla de salida, por si una prueba necesita contarlo. */
const contarEventos = () => almacen.contar();

/**
 * Levanta los dobles, los cablea y deja el esquema del gateway limpio.
 *
 * @returns {Promise<object>} el doble de identidad, que es el que más manipulan
 *   las suites. El de inmuebles se obtiene con `inmueblesFalso()`.
 */
const prepararEntorno = async () => {
    identidad = await crearIdentidadFalsa();
    inmuebles = await crearInmueblesFalso();

    // La costura lee `process.env` en cada petición, así que basta con ponerlo.
    process.env.MS_IDENTIDAD_URL = identidad.url;
    process.env.MS_INMUEBLES_URL = inmuebles.url;

    await recrearEsquema(sequelize);
    return identidad;
};

const cerrarEntorno = async () => {
    if (identidad) {
        await identidad.cerrar();
        identidad = null;
    }
    if (inmuebles) {
        await inmuebles.cerrar();
        inmuebles = null;
    }
    delete process.env.MS_IDENTIDAD_URL;
    delete process.env.MS_INMUEBLES_URL;
    await sequelize.close();
};

/** Los dobles en curso, para pruebas que necesiten inspeccionarlos. */
const identidadFalsa = () => identidad;
const inmueblesFalso = () => inmuebles;

/**
 * Crea un inmueble a través del gateway y devuelve su id.
 *
 * Va por la costura, como todo lo demás: así la petición atraviesa la matriz
 * RBAC y el reenvío, que es lo que interesa ejercitar.
 */
const crearInmueble = async (token, datos = {}) => {
    const respuesta = await request(app)
        .post('/api/inmuebles')
        .set(...conToken(token))
        .send({ direccion: 'Calle Falsa 123', tipo: 'apartamento', ...datos });

    return {
        respuesta,
        id: respuesta.body.inmueble ? respuesta.body.inmueble.id_inmueble : undefined
    };
};

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
    contarEventos,
    crearInmueble,
    crearInquilino,
    entregarEventos,
    identidadFalsa,
    iniciarSesion,
    inmueblesFalso,
    prepararEntorno,
    publicador,
    registrarPropietario,
    sequelize
};
