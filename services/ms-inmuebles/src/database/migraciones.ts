/**
 * Aplicador de migraciones de MS-Inmuebles: aplica los `.sql` de
 * `database/inmuebles/` y anota cada uno en la tabla de control de su esquema.
 */

import fs from 'fs';
import path from 'path';
import type { Sequelize, Transaction } from 'sequelize';

import { ESQUEMA } from '../config/database';

/** `<raiz del monorepo>/database/inmuebles`, desde `src/database/`. */
export const RUTA_BASE = path.resolve(__dirname, '../../../../database/inmuebles');

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

/** Clave del bloqueo consultivo que serializa a quien migra este esquema. */
const BLOQUEO = `migraciones:${ESQUEMA}`;

/** Toma el bloqueo DENTRO de la transaccion: se suelta solo al terminarla. */
const bloquear = (conexion: Sequelize, transaccion: Transaction): Promise<unknown> =>
  conexion.query('SELECT pg_advisory_xact_lock(hashtext(:clave))', {
    replacements: { clave: BLOQUEO },
    transaction: transaccion,
  });

const asegurarTablaControl = async (conexion: Sequelize): Promise<void> => {
  // Crea el esquema y la tabla de control, bajo el bloqueo.
  await conexion.transaction(async (transaccion) => {
    await bloquear(conexion, transaccion);
    await conexion.query(`CREATE SCHEMA IF NOT EXISTS ${ESQUEMA}`, { transaction: transaccion });
    await conexion.query(
      `
        CREATE TABLE IF NOT EXISTS ${TABLA_CONTROL} (
            nombre      VARCHAR(255) PRIMARY KEY,
            aplicada_en TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `,
      { transaction: transaccion },
    );
  });
};

/**
 * Aplica las migraciones que falten y devuelve los nombres de las aplicadas.
 * Cada una corre en su propia transacción junto con su anotación.
 */
export const aplicarMigraciones = async (conexion: Sequelize): Promise<string[]> => {
  await asegurarTablaControl(conexion);

  const aplicadas: string[] = [];

  for (const migracion of listarMigraciones()) {
    const sql = fs.readFileSync(migracion.ruta, 'utf8');

    // Se comprueba si ya está aplicada después de tomar el bloqueo.
    const aplicada = await conexion.transaction(async (transaccion) => {
      await bloquear(conexion, transaccion);

      const [filas] = await conexion.query(`SELECT 1 FROM ${TABLA_CONTROL} WHERE nombre = :nombre`, {
        replacements: { nombre: migracion.nombre },
        transaction: transaccion,
      });
      if ((filas as unknown[]).length > 0) {
        return false;
      }

      await conexion.query(sql, { transaction: transaccion });
      await conexion.query(`INSERT INTO ${TABLA_CONTROL} (nombre) VALUES (:nombre)`, {
        replacements: { nombre: migracion.nombre },
        transaction: transaccion,
      });
      return true;
    });

    if (aplicada) {
      aplicadas.push(migracion.nombre);
    }
  }

  return aplicadas;
};

/** Las migraciones de disco que la base no tiene anotadas. No escribe nada. */
export const migracionesPendientes = async (conexion: Sequelize): Promise<string[]> => {
  const nombres = listarMigraciones().map((migracion) => migracion.nombre);

  const [control] = await conexion.query('SELECT to_regclass(:tabla) AS tabla', {
    replacements: { tabla: TABLA_CONTROL },
  });
  if ((control as Array<{ tabla: string | null }>)[0]?.tabla == null) {
    return nombres;
  }

  const [filas] = await conexion.query(`SELECT nombre FROM ${TABLA_CONTROL}`);
  const anotadas = new Set((filas as Array<{ nombre: string }>).map((fila) => fila.nombre));
  return nombres.filter((nombre) => !anotadas.has(nombre));
};

/**
 * Vacía el esquema del servicio y vuelve a migrarlo, para las pruebas. Sólo con
 * `NODE_ENV=test`.
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
