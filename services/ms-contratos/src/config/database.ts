/**
 * Conexión de MS-Contratos a PostgreSQL. Todas sus tablas viven en el esquema
 * `contratos`, fijado también como `search_path`.
 */

import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import { enteroDeEntorno, textoDeEntorno, siNoDeEntorno } from 'arriendos360-shared';

dotenv.config();

/** Esquema propio del servicio. */
export const ESQUEMA = 'contratos';

const nombreBase =
  process.env['NODE_ENV'] === 'test'
    ? textoDeEntorno('DB_NAME_TEST', 'arriendos360_test')
    : textoDeEntorno('DB_NAME', 'arriendos360_db');

export const sequelize = new Sequelize(
  nombreBase,
  textoDeEntorno('DB_USER', 'postgres'),
  process.env['DB_PASSWORD'],
  {
    host: textoDeEntorno('DB_HOST', 'localhost'),
    port: enteroDeEntorno('DB_PORT', 5432),
    dialect: 'postgres',
    logging: false,
    schema: ESQUEMA,
    dialectOptions: {
      options: `-c search_path=${ESQUEMA}`,
      // Con `DB_SSL=si`, TLS verificando el certificado.
      ...(siNoDeEntorno('DB_SSL', false) ? { ssl: { rejectUnauthorized: true } } : {}),
    },
    // `DB_POOL_MAX`: conexiones por réplica.
    pool: { max: enteroDeEntorno('DB_POOL_MAX', 5), min: 0, acquire: 30000, idle: 10000 },
  },
);
