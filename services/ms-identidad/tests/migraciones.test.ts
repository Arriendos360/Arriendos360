/**
 * El aplicador de migraciones, fuera del arranque.
 *
 * En Azure las migraciones las aplica un Job antes de publicar la revision, y el
 * servicio solo comprueba (`MIGRACIONES_AL_ARRANCAR=no`). Lo que se fija aqui: dos
 * procesos migrando a la vez no chocan ni aplican nada dos veces, relanzar no hace
 * nada, y `migracionesPendientes` dice la verdad sin escribir.
 *
 * El runner es el mismo en los cinco servicios —solo cambia el esquema—, asi que se
 * prueba en uno.
 */

import { ESQUEMA } from '../src/config/database';
import {
  aplicarMigraciones,
  listarMigraciones,
  migracionesPendientes,
} from '../src/database/migraciones';
import { cerrarBase, recrearBase, sequelize } from './utiles/entorno';

const CONTROL = `${ESQUEMA}.migraciones_aplicadas`;
const nombres = (): string[] => listarMigraciones().map((migracion) => migracion.nombre);

beforeAll(async () => {
  await recrearBase();
});

afterAll(async () => {
  // Se deja el esquema migrado, como lo deja cualquier otra suite.
  await recrearBase();
  await cerrarBase();
});

describe('migracionesPendientes', () => {
  test('con el esquema recién migrado no queda nada pendiente', async () => {
    expect(await migracionesPendientes(sequelize)).toEqual([]);
  });

  test('una migración sin anotar aparece como pendiente, y comprobar no la aplica', async () => {
    const ultima = nombres().at(-1)!;
    await sequelize.query(`DELETE FROM ${CONTROL} WHERE nombre = :nombre`, {
      replacements: { nombre: ultima },
    });

    expect(await migracionesPendientes(sequelize)).toEqual([ultima]);
    expect(await migracionesPendientes(sequelize)).toEqual([ultima]);

    await sequelize.query(`INSERT INTO ${CONTROL} (nombre) VALUES (:nombre)`, {
      replacements: { nombre: ultima },
    });
  });

  test('sin esquema ni tabla de control, todas están pendientes', async () => {
    await sequelize.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);

    expect(await migracionesPendientes(sequelize)).toEqual(nombres());
  });
});

describe('aplicarMigraciones', () => {
  test('dos procesos A LA VEZ sobre una base vacía: sin errores y cada migración una sola vez', async () => {
    await sequelize.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);

    const [primero, segundo] = await Promise.all([
      aplicarMigraciones(sequelize),
      aplicarMigraciones(sequelize),
    ]);

    // Entre los dos aplicaron todas, y ninguna la aplicaron los dos.
    expect([...primero, ...segundo].sort()).toEqual([...nombres()].sort());
    expect(await migracionesPendientes(sequelize)).toEqual([]);
  });

  test('relanzar con todo aplicado no hace nada', async () => {
    expect(await aplicarMigraciones(sequelize)).toEqual([]);
  });
});
