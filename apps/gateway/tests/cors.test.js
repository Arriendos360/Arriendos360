/**
 * CORS del gateway.
 *
 * Lo que se fija: sin `CORS_ORIGENES` cualquier origen vale, como en desarrollo; con
 * ella, sólo los de la lista reciben la cabecera que el navegador exige.
 */

const cors = require('cors');
const express = require('express');
const request = require('supertest');

const { opcionesCors } = require('../src/routing/cors');

/** Una app mínima con el CORS configurado para este entorno. */
const appCon = (entorno) => {
    const app = express();
    app.use(cors(opcionesCors(entorno)));
    app.get('/api/algo', (req, res) => res.json({ ok: true }));
    return app;
};

describe('CORS del gateway', () => {
    test('sin CORS_ORIGENES, cualquier origen', async () => {
        const respuesta = await request(appCon({})).get('/api/algo').set('Origin', 'https://cualquiera.test');

        expect(respuesta.headers['access-control-allow-origin']).toBe('*');
    });

    test('con CORS_ORIGENES, el origen de la lista sí', async () => {
        const entorno = { CORS_ORIGENES: 'https://spa.azurestaticapps.net, https://otra.test' };
        const respuesta = await request(appCon(entorno))
            .get('/api/algo')
            .set('Origin', 'https://spa.azurestaticapps.net');

        expect(respuesta.headers['access-control-allow-origin']).toBe('https://spa.azurestaticapps.net');
    });

    test('con CORS_ORIGENES, un origen ajeno no recibe la cabecera', async () => {
        const entorno = { CORS_ORIGENES: 'https://spa.azurestaticapps.net' };
        const respuesta = await request(appCon(entorno)).get('/api/algo').set('Origin', 'https://ajeno.test');

        expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('una CORS_ORIGENES vacía cuenta como ausente', () => {
        expect(opcionesCors({ CORS_ORIGENES: ' , ' })).toEqual({});
    });
});
