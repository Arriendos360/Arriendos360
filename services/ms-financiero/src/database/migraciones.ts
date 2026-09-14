/**
 * Aplicador de migraciones de MS-Financiero.
 *
 * Misma idea que el del gateway: los `.sql` son datos y viven aparte, el runner
 * es codigo y viaja con el servicio. Cambian dos cosas.
 *
 * 1. Los `.sql` viven en `database/financiero/`, en la raiz del monorepo, que es
 *    donde CLAUDE.md ubica las migraciones: una carpeta por esquema. Salieron
 *    de `database/dominio/`, que con esto se queda vacia y DESAPARECE: eran las
 *    dos ultimas tablas que le quedaban al gateway.
 *
 * 2. La tabla de control tambien vive en el esquema `financiero`, para que este
 *    servicio no comparta ni siquiera el registro de que migraciones aplico.
 */

import fs from 'fs';
import path from 'path';
import type { Sequelize, Transaction } from 'sequelize';

import { ESQUEMA } from '../config/database';

/** `<raiz del monorepo>/database/financiero`, desde `src/database/`. */
export const RUTA_BASE = path.resolve(__dirname, '../../../../database/financiero');

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

/**
 * Clave del bloqueo consultivo que serializa a quien migra ESTE esquema.
 *
 * En Azure las migraciones las aplica un Job antes de publicar la revision, no cada
 * replica al arrancar; pero un Job se puede reintentar o lanzar dos veces. Con el
 * bloqueo, dos procesos migrando a la vez no chocan: el segundo espera y, al
 * obtenerlo, ve lo que dejo anotado el primero. Ver `docs/adr/0022`.
 */
const BLOQUEO = `migraciones:${ESQUEMA}`;

/** Toma el bloqueo DENTRO de la transaccion: se suelta solo al terminarla. */
const bloquear = (conexion: Sequelize, transaccion: Transaction): Promise<unknown> =>
  conexion.query('SELECT pg_advisory_xact_lock(hashtext(:clave))', {
    replacements: { clave: BLOQUEO },
    transaction: transaccion,
  });

const asegurarTablaControl = async (conexion: Sequelize): Promise<void> => {
  // El esquema tiene que existir antes que su tabla de control, y la primera
  // migracion es justamente la que lo crea. De ahi que se cree aqui tambien. Bajo el
  // bloqueo: dos `CREATE TABLE IF NOT EXISTS` simultaneos pueden chocar en el catalogo.
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
 *
 * Cada una corre en su propia transaccion junto con su registro en la tabla de
 * control: o se aplica entera y queda anotada, o no pasa nada.
 */
export const aplicarMigraciones = async (conexion: Sequelize): Promise<string[]> => {
  await asegurarTablaControl(conexion);

  const aplicadas: string[] = [];

  for (const migracion of listarMigraciones()) {
    const sql = fs.readFileSync(migracion.ruta, 'utf8');

    // La comprobacion de si ya esta aplicada va DENTRO de la transaccion y DESPUES del
    // bloqueo: si otro proceso la esta aplicando, se espera a que termine y se salta.
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

/**
 * Las migraciones de disco que la base no tiene anotadas. NO escribe nada: es lo que
 * usa el arranque con `MIGRACIONES_AL_ARRANCAR=no` para negarse a servir con el esquema
 * atrasado.
 */
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
 * Vacia el esquema del servicio y vuelve a migrarlo. Es el reemplazo de
 * `sequelize.sync({ force: true })` en las pruebas.
 *
 * Solo funciona con `NODE_ENV=test`, y solo borra `financiero`: aunque alguien
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
