/**
 * Conexion de MS-Financiero a PostgreSQL.
 *
 * Comparte instancia con el resto del sistema, pero NO esquema: las dos tablas
 * de este servicio viven en `financiero`, y el `searchPath` lo fija aqui para
 * que ninguna consulta pueda alcanzar `public` por descuido. Esa es la regla
 * dura 3 hecha configuracion en vez de disciplina.
 *
 * Importa especialmente durante el PR de extraccion: hasta que corre
 * `database/financiero/002` existen DOS pares de tablas —el de este esquema y el
 * que el gateway todavia tiene en `public`— y una consulta que resolviera al
 * esquema equivocado cobraria dos veces sin que nada lo dijera.
 *
 * El dia que este servicio se despliegue en Azure con su propia base, lo unico
 * que cambia es `DB_NAME`.
 */

import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

/** Esquema propio del servicio. */
export const ESQUEMA = 'financiero';

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
    schema: ESQUEMA,
    dialectOptions: {
      options: `-c search_path=${ESQUEMA}`,
    },
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
  },
);
