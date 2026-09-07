/**
 * Conexion de MS-Identidad a PostgreSQL.
 *
 * Comparte instancia con el resto del sistema, pero NO esquema: todas las tablas
 * de este servicio viven en `identidad`, y el `searchPath` lo fija aqui para que
 * ninguna consulta pueda alcanzar `public` por descuido. Esa es la regla dura 3
 * hecha configuracion en vez de disciplina.
 *
 * El dia que este servicio se despliegue en Azure con su propia base, lo unico
 * que cambia es `DB_NAME`.
 */

import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

/** Esquema propio del servicio. */
export const ESQUEMA = 'identidad';

const nombreBase =
  process.env['NODE_ENV'] === 'test'
    ? process.env['DB_NAME_TEST'] ?? 'arriendos360_test'
    : process.env['DB_NAME'] ?? 'arriendos360_db';

export const sequelize = new Sequelize(
  nombreBase,
  process.env['DB_USER'] ?? 'postgres',
  process.env['DB_PASSWORD'],
  {
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5432),
    dialect: 'postgres',
    logging: false,
    // Todos los modelos nacen en `identidad` sin tener que repetirlo uno a uno.
    schema: ESQUEMA,
    dialectOptions: {
      // Cinturon y tirantes: aunque un modelo olvidara declarar el esquema, el
      // search_path de la sesion no incluye `public` para las tablas de negocio.
      options: `-c search_path=${ESQUEMA}`,
    },
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
  },
);
