/**
 * Utilidades comunes de las pruebas del gateway.
 *
 * Desde el paso 6e el gateway NO SIRVE NINGÚN RECURSO: `/api/auth`,
 * `/api/usuarios`, `/api/inmuebles`, `/api/contratos` y `/api/pagos` los sirven
 * los cuatro servicios, y lo único local que queda es `/api/dashboard`. Así que
 * las suites no pueden crear nada contra el `app` en proceso: se levanta un
 * DOBLE de cada servicio (`tests/dobles/`) y se apuntan las `MS_*_URL` a ellos;
 * la costura reenvía igual que en producción, sólo que al otro extremo hay un
 * servidor de mentira con estado en memoria.
 *
 * ── Y TAMPOCO HAY BASE DE DATOS ─────────────────────────────────────────────
 *
 * Esto es lo que más cambia en el paso 6e. Aquí se hacía `recrearEsquema()`
 * contra `public` antes de cada suite, porque el gateway tenía tablas; ya no las
 * tiene, así que no hay esquema que recrear ni conexión que cerrar. Las suites
 * del gateway pasan a correr **sin PostgreSQL**, que es la consecuencia bonita
 * de que el gateway se haya quedado sin estado.
 *
 * EL ORDEN DE CREACIÓN IMPORTA: el doble de contratos recibe el de inmuebles,
 * porque resuelve la pertenencia preguntándole de quién es cada inmueble —igual
 * que el servicio real, que no guarda `id_propietario` en el contrato.
 *
 * Consecuencia práctica: `prepararEntorno()` tiene que llamarse ANTES de la
 * primera petición, y `cerrarEntorno()` al final para no dejar el puerto abierto.
 */

const request = require('supertest');
const { cabeceraDeServicio } = require('arriendos360-shared');

const app = require('../../src/app');
const { crearContratosFalso } = require('../dobles/contratos');
const { crearFinancieroFalso } = require('../dobles/financiero');
const { crearIdentidadFalsa } = require('../dobles/identidad');
const { crearInmueblesFalso } = require('../dobles/inmuebles');

const CONTRASENA_POR_DEFECTO = 'pass123';

/** Los dobles activos. Los comparten los helpers de este módulo. */
let identidad = null;
let inmuebles = null;
let contratos = null;
let financiero = null;

/**
 * Entrega los eventos que el doble de contratos tenga en su bandeja.
 *
 * ── EL PUBLICADOR YA NO ES DEL GATEWAY ──────────────────────────────────────
 *
 * Hasta el paso 6d esto llamaba al publicador real del gateway sobre su tabla de
 * salida. Ahora el productor es ms-contratos, así que lo que hay en proceso es
 * su doble y una bandeja en memoria; esta función hace de publicador: saca los
 * sobres y los entrega al doble de inmuebles por la MISMA ruta que usa el
 * transporte real, `POST /interno/eventos`, con credencial de servicio.
 *
 * Lo que se conserva —y es lo que importa— es que no hay temporizador: la
 * entrega ocurre cuando la prueba la pide. Es lo que hace que «todavía no se ha
 * entregado» sea una afirmación comprobable y no una carrera.
 *
 * Lo que se PIERDE respecto del publicador real es el reintento con espera y el
 * apartado tras N intentos. Eso ya no se prueba aquí porque ya no es del
 * gateway: se prueba en `services/ms-contratos/tests/eventos.test.ts`, contra el
 * publicador de verdad.
 *
 * @returns {Promise<{entregados: number, fallidos: number}>}
 */
const entregarEventos = async () => {
    if (!contratos || !inmuebles) {
        return { entregados: 0, fallidos: 0 };
    }

    const sobres = contratos.vaciarSalida();
    let entregados = 0;
    let fallidos = 0;

    for (const sobre of sobres) {
        const respuesta = await fetch(`${inmuebles.url}/interno/eventos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...cabeceraDeServicio({
                    emisor: 'ms-contratos',
                    destinatario: 'ms-inmuebles',
                    secreto: process.env.SERVICIO_JWT_SECRET
                })
            },
            body: JSON.stringify(sobre)
        });

        if (respuesta.ok) {
            entregados += 1;
        } else {
            fallidos += 1;
            // Se devuelve a la bandeja: la entrega es al-menos-una-vez y un
            // fallo no pierde el evento.
            contratos.salida.push(sobre);
        }
    }

    return { entregados, fallidos };
};

/** Lo que queda por entregar, por si una prueba necesita contarlo. */
const contarEventos = async () => (contratos ? contratos.salida.length : 0);

/**
 * Levanta los cuatro dobles y los cablea.
 *
 * @returns {Promise<object>} el doble de identidad, que es el que más manipulan
 *   las suites. Los otros tres se obtienen con `inmueblesFalso()`,
 *   `contratosFalso()` y `financieroFalso()`.
 */
const prepararEntorno = async () => {
    identidad = await crearIdentidadFalsa();
    inmuebles = await crearInmueblesFalso();
    // El de contratos NECESITA los otros dos: resuelve la pertenencia
    // preguntándole a Inmuebles de quién es cada inmueble, y compone el
    // `Inquilino` con los datos de Identidad. Igual que el servicio real.
    contratos = await crearContratosFalso({ identidad, inmuebles });
    // El de financiero no necesita a nadie: en el servicio real la pertenencia
    // se la resuelve ms-contratos, y aquí las suites la declaran.
    financiero = await crearFinancieroFalso();

    // La costura lee `process.env` en cada petición, así que basta con ponerlo.
    process.env.MS_IDENTIDAD_URL = identidad.url;
    process.env.MS_INMUEBLES_URL = inmuebles.url;
    process.env.MS_CONTRATOS_URL = contratos.url;
    process.env.MS_FINANCIERO_URL = financiero.url;

    // NO hay `recrearEsquema()`: el gateway no tiene tablas desde el paso 6e.
    return identidad;
};

const cerrarEntorno = async () => {
    for (const doble of [identidad, inmuebles, contratos, financiero]) {
        if (doble) {
            await doble.cerrar();
        }
    }

    identidad = null;
    inmuebles = null;
    contratos = null;
    financiero = null;

    delete process.env.MS_IDENTIDAD_URL;
    delete process.env.MS_INMUEBLES_URL;
    delete process.env.MS_CONTRATOS_URL;
    delete process.env.MS_FINANCIERO_URL;

    // Tampoco hay `sequelize.close()`: no hay conexión que cerrar.
};

/** Los dobles en curso, para pruebas que necesiten inspeccionarlos. */
const identidadFalsa = () => identidad;
const inmueblesFalso = () => inmuebles;
const contratosFalso = () => contratos;
const financieroFalso = () => financiero;

/**
 * Crea un contrato a través del gateway y devuelve su id.
 *
 * Va por la costura, como todo lo demás: así la petición atraviesa la matriz
 * RBAC y el reenvío, que es lo que interesa ejercitar.
 */
const crearContrato = async (token, datos = {}) => {
    const respuesta = await request(app)
        .post('/api/contratos')
        .set(...conToken(token))
        .send({ inicio: '2026-01-01', fin: '2026-12-31', canon: 1000, ...datos });

    return {
        respuesta,
        id: respuesta.body.contrato ? respuesta.body.contrato.id_contrato : undefined
    };
};

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
    contratosFalso,
    crearContrato,
    crearInmueble,
    crearInquilino,
    entregarEventos,
    financieroFalso,
    identidadFalsa,
    iniciarSesion,
    inmueblesFalso,
    prepararEntorno,
    registrarPropietario
};
