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
const { enteroDeEntorno, validarEntorno } = require('arriendos360-shared');

/**
 * El gateway, y desde el paso 6e NADA MÁS que el gateway.
 *
 * ── LO QUE DESAPARECIÓ DE ESTE ARCHIVO, Y POR QUÉ IMPORTA ───────────────────
 *
 * Se fueron `sequelize`, los modelos, las migraciones y el motor financiero. No
 * es limpieza: es que **el gateway se quedó sin tablas propias**, que es lo que
 * el Capítulo 2 dice que tiene que ser. `cuentas_cobro` y `transacciones` eran
 * las dos últimas y se fueron con ms-financiero.
 *
 * La consecuencia práctica es que este proceso YA NO ABRE UNA CONEXIÓN A
 * POSTGRESQL. Ninguna. Arranca sin base, y si la base está caída el gateway
 * sigue en pie devolviendo 502 de los servicios que no responden, en vez de no
 * levantarse. Es lo que se espera de un *Policy Enforcement Point*.
 *
 * Lo que le queda es exactamente lo que el Capítulo 2 le asigna:
 *
 *   1. Validar el JWT y la revocación, y aplicar la MATRIZ RBAC (capa 2).
 *   2. Los GUARDIAS: reglas que dependen de dos contextos y ningún servicio
 *      puede aplicar solo.
 *   3. La COSTURA de enrutamiento, que reenvía cada prefijo a su servicio.
 *   4. El DASHBOARD, que agrega respuestas de los otros tres y no tiene tablas
 *      (regla dura 5).
 */
const app = express();

/**
 * Caché de tokens revocados.
 *
 * Se crea aquí y se inyecta en el control de acceso, en vez de que éste la
 * importe: así queda a la vista quién es dueño de su ciclo de vida, y las
 * pruebas de la matriz pueden pasar la suya sin red ni base.
 */
const cacheRevocados = crearCacheRevocados();

app.use(cors());

// Control de acceso (Capa 2 del módulo de seguridad): la matriz RBAC decide si
// la petición sigue viva. Va ANTES de la costura para que una petición denegada
// nunca llegue a la red interna, y antes de express.json() para no consumir el
// cuerpo.
app.use(crearControlDeAcceso({ tokenInvalidado: cacheRevocados.tokenInvalidado }));

// Guardias: reglas que ningún servicio puede aplicar solo porque dependen de
// datos de otro contexto. Hoy solo una — no borrar un inmueble con contrato
// activo. Van después del RBAC, que ya dijo quién pregunta, y antes de la
// costura, porque deciden si la petición llega a salir a la red.
app.use(crearGuardiaDeBorrado());

// Costura de enrutamiento. Desde el paso 6e reenvía CINCO de los seis prefijos:
// /api/auth y /api/usuarios a ms-identidad, /api/inmuebles a ms-inmuebles,
// /api/contratos a ms-contratos y /api/pagos a ms-financiero. El único que se
// resuelve aquí es /api/dashboard, y lo hace para siempre.
//
// Va antes de express.json() a propósito, para que el cuerpo llegue sin parsear
// al reenvío y multipart/form-data (los anexos, que sirve ms-contratos)
// funcione.
app.use(crearEnrutadorGateway());

app.use(express.json());

// AQUI ESTABA `app.use('/uploads', express.static('uploads'))`.
//
// Servia los contratos escaneados a cualquiera que conociera la URL: iba antes
// de todo middleware de token, asi que ni la matriz RBAC ni `verificarToken` lo
// veian pasar. Desde el paso 6b los archivos son `Anexos` y salen unicamente por
// `GET /api/contratos/:id/anexos/:idAnexo`, que pasa por la matriz y por el ABAC
// del controlador; desde el 6d ese endpoint lo sirve ms-contratos, y la matriz
// lo sigue mirando antes de que la peticion salga a la red.

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

// La ÚNICA ruta local que queda. Se queda para siempre: agrega respuestas de los
// demás servicios y no tiene tablas propias (regla dura 5).
app.use('/api/dashboard', dashboardRoutes);

const PORT = enteroDeEntorno('PORT', 3001);

/**
 * Lo que no tiene defecto razonable. Las cuatro URL tambien: desde el paso 6e no queda
 * ningun prefijo local al que caer, así que un prefijo sin URL no se reenvía y acaba
 * en 404 sin que nada lo explique.
 */
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
            // NO hay `sequelize.authenticate()` ni `aplicarMigraciones()`. El
            // gateway no tiene base desde el paso 6e; las migraciones que le
            // quedaban se fueron con `database/dominio/`, que ya no existe.
            //
            // Tampoco arranca el publicador del bus —se fue en el 6d con la
            // tabla de salida— ni el motor financiero, que ahora corre en
            // ms-financiero.

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
            // Mejor no levantar que quedar en pie a medias, como hacen los servicios.
            process.exit(1);
        }
    };

    iniciarServidor();
}
