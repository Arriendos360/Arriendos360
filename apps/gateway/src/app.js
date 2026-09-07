const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sequelize } = require('./config/database');
require('./models'); // Importar modelos para registrar sus asociaciones

// Importar rutas
const contratoRoutes = require('./routes/contrato.routes');
const pagoRoutes = require('./routes/pago.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const { iniciarMotorFinanciero } = require('./services/financialEngine');
const {
    crearControlDeAcceso,
    crearEnrutadorGateway,
    crearGuardiaDeBorrado,
    describirEnrutamiento,
    describirMatriz
} = require('./routing');
const { crearCacheRevocados } = require('./routing/cacheRevocados');
const { aplicarMigraciones } = require('./database/migraciones');

// Crear aplicación Express
const app = express();

/**
 * Caché de tokens revocados.
 *
 * Se crea aquí y se inyecta en el control de acceso, en vez de que éste la
 * importe: así queda a la vista quién es dueño de su ciclo de vida, y las
 * pruebas de la matriz pueden pasar la suya sin red ni base.
 */
const cacheRevocados = crearCacheRevocados();

// Middlewares
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

// Costura de enrutamiento: reenvía a ms-identidad los prefijos /api/auth y
// /api/usuarios, a ms-inmuebles /api/inmuebles, y deja pasar el resto al código
// local de abajo. Va antes de express.json() a propósito, para que el cuerpo
// llegue sin parsear al reenvío y multipart/form-data (anexos) funcione.
app.use(crearEnrutadorGateway());

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Ruta de prueba
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

// Rutas locales. `/api/auth`, `/api/usuarios` e `/api/inmuebles` ya no
// aparecen: los sirven ms-identidad y ms-inmuebles, y la costura los reenvía
// antes de llegar hasta aquí.
app.use('/api/contratos', contratoRoutes);
app.use('/api/pagos', pagoRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Puerto
const PORT = process.env.PORT || 3001;

// Exportar app para pruebas
module.exports = app;
module.exports.cacheRevocados = cacheRevocados;

// Iniciar servidor solo si no estamos en modo pruebas
if (process.env.NODE_ENV !== 'test') {
    const iniciarServidor = async () => {
        try {
            await sequelize.authenticate();
            console.log('✅ Conexión a PostgreSQL exitosa');
            
            // Migraciones versionadas en lugar de sequelize.sync(). Con el paso
            // a UUID, sync() dejó de poder reproducir el esquema: no sabe generar
            // identificadores en la aplicación. Ver docs/adr/0003.
            const aplicadas = await aplicarMigraciones(sequelize);
            console.log(
                aplicadas.length > 0
                    ? `✅ Migraciones aplicadas: ${aplicadas.join(', ')}`
                    : '✅ Esquema al día, sin migraciones pendientes'
            );

            // Iniciar Motor Financiero (Background Tasks)
            iniciarMotorFinanciero();

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
            console.error('❌ Error de conexión:', error);
        }
    };

    iniciarServidor();
}
