/**
 * Conexion de MS-Notificaciones a PostgreSQL.
 *
 * Comparte instancia con el resto del sistema, pero NO esquema: las dos tablas de
 * este servicio viven en `notificaciones`, y el `searchPath` lo fija aqui para
 * que ninguna consulta pueda alcanzar `public` ni el esquema de otro servicio por
 * descuido. Esa es la regla dura 3 hecha configuracion en vez de disciplina.
 *
 * ── ESTE SERVICIO TIENE BASE AUNQUE NO TENGA DOMINIO ────────────────────────
 *
 * El catalogo de microservicios le asigna «ninguna» tabla, y es cierto en lo que
 * importa: no es dueño de ningun concepto del negocio. Pero necesita dos tablas
 * operativas y las necesita de verdad — sin la bitacora de eventos procesados
 * mandaria correos repetidos, y sin la de envios no habria forma de saber si un
 * aviso salio. Es la misma categoria de `identidad.tokens_revocados`: un mecanismo
 * que requiere estado, no un agregado.
 *
 * Que las dos vivan en la MISMA base que la bandeja de salida de nadie es lo que
 * hace posible la idempotencia: el consumidor anota el evento y redacta los
 * envios en una sola transaccion. Contra dos bases eso no existiria.
 */

import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import { enteroDeEntorno, textoDeEntorno, siNoDeEntorno } from 'arriendos360-shared';

dotenv.config();

/** Esquema propio del servicio. */
export const ESQUEMA = 'notificaciones';

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
