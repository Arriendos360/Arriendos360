/**
 * Aplicador de migraciones de MS-Notificaciones.
 *
 * El mismo de los otros cuatro servicios, sin una linea propia: los `.sql` son
 * datos y viven en `database/notificaciones/`, el runner es codigo y viaja con el
 * servicio, y la tabla de control vive en el esquema del servicio para que ni el
 * registro de que migraciones se aplicaron se comparta con nadie.
 *
 * A diferencia de los otros cuatro, este NO ADOPTA NADA. Las extracciones de los
 * pasos 4 a 6 traian una migracion que copiaba tablas desde `public` y otra que
 * las retiraba, porque las tablas ya existian en el monolito. Aqui no hay nada
 * que mudar: ms-notificaciones no le quita una tabla a nadie, porque lo que se
 * lleva son dos mailers y unas plantillas, que son codigo. Sus dos tablas nacen
 * vacias y son nuevas.
 *
 * Ver `docs/adr/0003`.
 */

import fs from 'fs';
import path from 'path';
import type { Sequelize } from 'sequelize';

import { ESQUEMA } from '../config/database';

/** `<raiz del monorepo>/database/notificaciones`, desde `src/database/`. */
export const RUTA_BASE = path.resolve(__dirname, '../../../../database/notificaciones');

const TABLA_CONTROL = `${ESQUEMA}.migraciones_aplicadas`;

export interface Migracion {
  nombre: string;
  ruta: string;
}

/** Lista las migraciones de disco, en orden estable. */
export const listarMigraciones = (): Migracion[] => {
  if (!fs.existsSync(RUTA_BASE)) {
    return [];
  }

  return fs
    .readdirSync(RUTA_BASE)
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort()
    .map((archivo) => ({ nombre: archivo, ruta: path.join(RUTA_BASE, archivo) }));
};

const asegurarTablaControl = async (conexion: Sequelize): Promise<void> => {
  // El esquema tiene que existir antes que su tabla de control, y la primera
  // migracion es justamente la que lo crea. De ahi que se cree aqui tambien.
  await conexion.query(`CREATE SCHEMA IF NOT EXISTS ${ESQUEMA}`);
  await conexion.query(`
        CREATE TABLE IF NOT EXISTS ${TABLA_CONTROL} (
            nombre      VARCHAR(255) PRIMARY KEY,
            aplicada_en TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);
};

/**
 * Aplica las migraciones que falten y devuelve los nombres de las aplicadas.
 *
 * Cada una corre en su propia transaccion junto con su registro en la tabla de
 * control: o se aplica entera y queda anotada, o no pasa nada.
 */
export const aplicarMigraciones = async (conexion: Sequelize): Promise<string[]> => {
  await asegurarTablaControl(conexion);

  const [filas] = await conexion.query(`SELECT nombre FROM ${TABLA_CONTROL}`);
  const yaAplicadas = new Set((filas as Array<{ nombre: string }>).map((f) => f.nombre));

  const aplicadas: string[] = [];

  for (const migracion of listarMigraciones()) {
    if (yaAplicadas.has(migracion.nombre)) {
      continue;
    }

    const sql = fs.readFileSync(migracion.ruta, 'utf8');

    await conexion.transaction(async (transaccion) => {
      await conexion.query(sql, { transaction: transaccion });
      await conexion.query(`INSERT INTO ${TABLA_CONTROL} (nombre) VALUES (:nombre)`, {
        replacements: { nombre: migracion.nombre },
        transaction: transaccion,
      });
    });

    aplicadas.push(migracion.nombre);
  }

  return aplicadas;
};

/**
 * Vacia el esquema del servicio y vuelve a migrarlo. Es el reemplazo de
 * `sequelize.sync({ force: true })` en las pruebas.
 *
 * Solo funciona con `NODE_ENV=test`, y solo borra `notificaciones`: aunque alguien
 * lo ejecutara por error contra la base de desarrollo, `public` y los esquemas
 * de los demas servicios quedarian intactos.
 */
export const recrearEsquema = async (conexion: Sequelize): Promise<string[]> => {
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error(
      `recrearEsquema() solo puede ejecutarse con NODE_ENV=test: borra el esquema ${ESQUEMA} entero.`,
    );
  }

  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  await conexion.query(`CREATE SCHEMA ${ESQUEMA}`);

  return aplicarMigraciones(conexion);
};
