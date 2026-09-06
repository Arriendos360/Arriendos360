const { sequelize } = require('./src/config/database');
const Usuario = require('./src/models/Usuario');
const Propietario = require('./src/models/Propietario');
const bcrypt = require('bcryptjs');

const seed = async () => {
    try {
        await sequelize.authenticate();
        console.log('Conectado para seeding...');

        // Crear Propietario de prueba
        const hash = await bcrypt.hash('admin123', 10);
        const usuario = await Usuario.create({
            correo: 'admin@arriendos360.com',
            hash_contrasena: hash,
            rol: 'propietario',
            nombres: 'Sebastian',
            apellidos: 'Admin',
            telefono: '3001234567'
        });

        await Propietario.create({
            id_propietario: '10203040',
            id_usuario: usuario.id_usuario
        });

        console.log('✅ Usuario de prueba creado exitosamente:');
        console.log('📧 Correo: admin@arriendos360.com');
        console.log('🔑 Contraseña: admin123');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error en el seeding:', error);
        process.exit(1);
    }
};

seed();