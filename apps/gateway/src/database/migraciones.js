/**
 * Aplicador de migraciones versionadas.
 *
 * Reemplaza a `sequelize.sync()`, que creaba las tablas infiriéndolas de los
 * modelos. Con el paso a UUID eso dejó de ser viable: `sync()` no sabe generar
 * identificadores en la aplicación ni respetar el orden de las referencias
 * lógicas, y en producción es directamente peligroso.
 *
 * Reparto de responsabilidades a propósito:
 *
 *   - Los `.sql` son DATOS y viven en `database/<esquema>/`, en la raíz del
 *     monorepo, donde CLAUDE.md los ubica y donde el paso 3b podrá llevárselos
 *     junto con ms-identidad.
 *   - Este runner es CÓDIGO y viaja con el gateway. Cuando haya un segundo
 *     servicio que necesite migrar, subirá a `packages/shared`.
 *
 * La ruta se resuelve relativa a este archivo y punto. Antes había una variable
 * `RUTA_MIGRACIONES` que la sobrescribía, porque el build usaba contexto
 * `apps/gateway` y los `.sql` tenían que entrar por volumen en `/database`. Con
 * el build en el contexto raíz, `database/` entra por COPY y queda en el mismo
 * sitio relativo dentro y fuera del contenedor, así que el parche sobra.
 */

const fs = require('fs');
const path = require('path');

/** Esquemas en orden de aplicación. `dominio` no depende de `identidad`, pero
 *  fijar el orden hace reproducible el resultado. */
const ESQUEMAS = ['identidad', 'dominio'];

/** `<raiz del monorepo>/database`, desde `apps/gateway/src/database/`. */
const RUTA_BASE = path.resolve(__dirname, '../../../../database');

const TABLA_CONTROL = 'migraciones_aplicadas';

/** Lista las migraciones de disco como `{ nombre, ruta }`, en orden estable. */
const listarMigraciones = () => {
    const encontradas = [];

    for (const esquema of ESQUEMAS) {
        const carpeta = path.join(RUTA_BASE, esquema);
        if (!fs.existsSync(carpeta)) {
            continue;
        }

        const archivos = fs
            .readdirSync(carpeta)
            .filter((archivo) => archivo.endsWith('.sql'))
            .sort();

        for (const archivo of archivos) {
            // El nombre incluye el esquema para que dos migraciones `001_...`
            // de esquemas distintos no colisionen en la tabla de control.
            encontradas.push({
                nombre: `${esquema}/${archivo}`,
                ruta: path.join(carpeta, archivo)
            });
        }
    }

    return encontradas;
};

const asegurarTablaControl = async (sequelize) => {
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS ${TABLA_CONTROL} (
            nombre      VARCHAR(255) PRIMARY KEY,
            aplicada_en TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);
};

/**
 * Aplica las migraciones que falten y devuelve los nombres de las aplicadas.
 *
 * Cada migración corre dentro de su propia transacción junto con el registro en
 * la tabla de control: o se aplica entera y queda anotada, o no pasa nada.
 */
const aplicarMigraciones = async (sequelize) => {
    await asegurarTablaControl(sequelize);

    const [filas] = await sequelize.query(`SELECT nombre FROM ${TABLA_CONTROL}`);
    const yaAplicadas = new Set(filas.map((fila) => fila.nombre));

    const aplicadas = [];

    for (const migracion of listarMigraciones()) {
        if (yaAplicadas.has(migracion.nombre)) {
            continue;
        }

        const sql = fs.readFileSync(migracion.ruta, 'utf8');

        await sequelize.transaction(async (transaccion) => {
            await sequelize.query(sql, { transaction: transaccion });
            await sequelize.query(
                `INSERT INTO ${TABLA_CONTROL} (nombre) VALUES (:nombre)`,
                { replacements: { nombre: migracion.nombre }, transaction: transaccion }
            );
        });

        aplicadas.push(migracion.nombre);
    }

    return aplicadas;
};

/**
 * Vacía la base y vuelve a aplicar todas las migraciones. Es el reemplazo de
 * `sequelize.sync({ force: true })` en las pruebas.
 *
 * Sólo funciona con `NODE_ENV=test`. La guarda no es decorativa: un
 * `DROP SCHEMA public CASCADE` contra la base de desarrollo se lleva por delante
 * todo el trabajo de una demo.
 */
const recrearEsquema = async (sequelize) => {
    if (process.env.NODE_ENV !== 'test') {
        throw new Error(
            'recrearEsquema() sólo puede ejecutarse con NODE_ENV=test: borra la base entera.'
        );
    }

    await sequelize.query('DROP SCHEMA public CASCADE');
    await sequelize.query('CREATE SCHEMA public');

    return aplicarMigraciones(sequelize);
};

module.exports = { ESQUEMAS, RUTA_BASE, aplicarMigraciones, listarMigraciones, recrearEsquema };
