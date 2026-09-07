const { Sequelize } = require('sequelize');
require('dotenv').config();

const dbName = process.env.NODE_ENV === 'test' 
    ? 'arriendos360_test' 
    : (process.env.DB_NAME || 'arriendos360_db');

const sequelize = new Sequelize(
    dbName,
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'postgres123',
    {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    }
);

const testConnection = async () => {
    try {
        await sequelize.authenticate();
        console.log('✅ Conexión a la base de datos establecida correctamente.');
    } catch (error) {
        console.error('❌ No se pudo conectar a la base de datos:', error);
    }
};

module.exports = { sequelize, testConnection };