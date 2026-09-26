const express = require('express');
const cors = require('cors');
require('dotenv').config();

const dashboardRoutes = require('./routes/dashboard.routes');
const {
    crearControlDeAcceso,
    crearEnrutadorGateway,
    crearGuardiaDeBorrado,
    describirEnrutamiento,
    describirMatriz
} = require('./routing');
const { crearCacheRevocados } = require('./routing/cacheRevocados');
const { crearConfianzaDeProxy } = require('./routing/origen');
const { opcionesCors } = require('./routing/cors');
const { enteroDeEntorno, validarEntorno } = require('arriendos360-shared');

/**
 * Gateway: JWT y matriz RBAC, guardias, costura hacia los servicios y dashboard.
 * No tiene base de datos.
 */
const app = express();

// IP del cliente, según PROXY_SALTOS_CONFIANZA. Ver `routing/origen.js`.
app.set('trust proxy', crearConfianzaDeProxy());

/** Caché de tokens revocados, inyectada en el control de acceso. */
const cacheRevocados = crearCacheRevocados();

// Sin CORS_ORIGENES, cualquier origen (desarrollo); en Azure, sólo la SPA. Ver `routing/cors.js`.
app.use(cors(opcionesCors()));

// Control de acceso: JWT y matriz RBAC. Antes de la costura, para que lo denegado
// no llegue a la red interna, y antes de express.json(), para no consumir el cuerpo.
app.use(crearControlDeAcceso({ tokenInvalidado: cacheRevocados.tokenInvalidado }));

// Guardias: reglas que dependen de dos contextos. Después del RBAC, antes de la costura.
app.use(crearGuardiaDeBorrado());

// Costura: reenvía cada prefijo a su servicio. Antes de express.json(), para que
// el cuerpo (incluido multipart) llegue sin parsear.
app.use(crearEnrutadorGateway());

app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        mensaje: '🏠 API Arriendos360 funcionando',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            usuarios: '/api/usuarios',
            inmuebles: '/api/inmuebles',
            contratos: '/api/contratos',
            pagos: '/api/pagos'
        }
    });
});

// Única ruta local: el dashboard compone respuestas de los servicios.
app.use('/api/dashboard', dashboardRoutes);

const PORT = enteroDeEntorno('PORT', 3001);

/** Variables obligatorias: secretos y la URL de cada servicio. */
const OBLIGATORIAS = [
    'JWT_SECRET',
    'SERVICIO_JWT_SECRET',
    'MS_IDENTIDAD_URL',
    'MS_INMUEBLES_URL',
    'MS_CONTRATOS_URL',
    'MS_FINANCIERO_URL'
];

// Exportar app para pruebas
module.exports = app;
module.exports.cacheRevocados = cacheRevocados;

// Iniciar servidor solo si no estamos en modo pruebas
if (process.env.NODE_ENV !== 'test') {
    const iniciarServidor = async () => {
        try {
            validarEntorno('gateway', OBLIGATORIAS);

            await cacheRevocados.iniciar();
            const estado = cacheRevocados.estado();
            console.log(
                `🔑 Caché de invalidación: ${estado.vigentes} tokens revocados, ` +
                    `${estado.sesionesInvalidadas} usuarios con sesiones caídas, ` +
                    `refresco cada ${estado.intervaloMs / 1000}s` +
                    `${estado.ultimoError ? ` — ÚLTIMO FALLO: ${estado.ultimoError}` : ''}`
            );

            console.log(`🔀 ${describirEnrutamiento()}`);
            console.log(`🛡️  ${describirMatriz()}`);

            app.listen(PORT, () => {
                console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
            });
        } catch (error) {
            console.error('❌ Error de arranque:', error);
            process.exit(1);
        }
    };

    iniciarServidor();
}
