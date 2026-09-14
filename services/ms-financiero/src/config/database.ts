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
import { enteroDeEntorno, textoDeEntorno, siNoDeEntorno } from 'arriendos360-shared';

dotenv.config();

/** Esquema propio del servicio. */
export const ESQUEMA = 'financiero';

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
      // En Azure la base exige TLS (`DB_SSL=si`), y se verifica el certificado: TLS sin
      // verificar cifra, pero no dice con quien se habla.
      ...(siNoDeEntorno('DB_SSL', false) ? { ssl: { rejectUnauthorized: true } } : {}),
    },
    // Cada replica cuenta contra el limite de conexiones de la base; en Azure B1ms son 35
    // para los cinco servicios y sus Jobs (`DB_POOL_MAX`).
    pool: { max: enteroDeEntorno('DB_POOL_MAX', 5), min: 0, acquire: 30000, idle: 10000 },
  },
);
