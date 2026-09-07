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
const adminRoutes = require('./routes/admin.routes');
const { iniciarMotorFinanciero } = require('./services/financialEngine');

// Crear aplicación Express
const app = express();

// Middlewares
app.use(cors());
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
app.use('/api/inmuebles', inmuebleRoutes);
app.use('/api/contratos', contratoRoutes);
app.use('/api/pagos', pagoRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);

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
            
            // Sincronizar modelos (crear tablas si no existen)
            await sequelize.sync();
            console.log('✅ Tablas sincronizadas');

            // Iniciar Motor Financiero (Background Tasks)
            iniciarMotorFinanciero();
            
            app.listen(PORT, () => {
                console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
            });
        } catch (error) {
            console.error('❌ Error de conexión:', error);
        }
    };

    iniciarServidor();
}
