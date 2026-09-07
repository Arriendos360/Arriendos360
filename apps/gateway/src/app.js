const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sequelize } = require('./config/database');
const models = require('./models'); // Importar modelos para sincronización

// Importar rutas
const authRoutes = require('./routes/auth.routes');
const inmuebleRoutes = require('./routes/inmueble.routes');
const contratoRoutes = require('./routes/contrato.routes');
const pagoRoutes = require('./routes/pago.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const { iniciarMotorFinanciero } = require('./services/financialEngine');
const {
    crearControlDeAcceso,
    crearEnrutadorGateway,
    describirEnrutamiento,
    describirMatriz
} = require('./routing');
const { aplicarMigraciones } = require('./database/migraciones');

// Crear aplicación Express
const app = express();

// Middlewares
app.use(cors());

// Control de acceso (Capa 2 del módulo de seguridad): la matriz RBAC decide si
// la petición sigue viva. Va ANTES de la costura para que una petición denegada
// nunca llegue a la red interna, y antes de express.json() para no consumir el
// cuerpo.
app.use(crearControlDeAcceso());

// Costura de enrutamiento: reenvía al microservicio los prefijos que ya se
// extrajeron y deja pasar el resto al código local de abajo. Va antes de
// express.json() a propósito, para que el cuerpo llegue sin parsear al reenvío
// y multipart/form-data (anexos) funcione. Hoy todos los prefijos son locales.
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
            inmuebles: '/api/inmuebles',
            contratos: '/api/contratos',
            pagos: '/api/pagos'
        }
    });
});

// Usar rutas
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/inmuebles', inmuebleRoutes);
app.use('/api/contratos', contratoRoutes);
app.use('/api/pagos', pagoRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Puerto
const PORT = process.env.PORT || 3001;

// Exportar app para pruebas
module.exports = app;

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
