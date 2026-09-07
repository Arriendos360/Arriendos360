/**
 * Columnas de auditoría comunes a toda tabla de dominio.
 *
 * El Capítulo 2 exige `creado_por`, `fecha_creacion`, `ultima_actualizacion` y
 * `actualizado_por` en las ocho tablas. Las dos fechas las lleva Sequelize solo
 * (`timestamps` con nombres personalizados); los dos autores hay que decírselos.
 *
 * Para no repetir la asignación en los ~16 sitios que escriben, los hooks toman
 * el autor de `options.usuarioAuditor`. Los controladores pasan el `sub` del
 * token; el motor financiero y las pruebas no pasan nada y caen en
 * USUARIO_SISTEMA, que es exactamente lo que queremos registrar cuando el cambio
 * no lo origina una persona.
 */

const { DataTypes } = require('sequelize');

const { USUARIO_SISTEMA } = require('./constantes');

/** Definición de las dos columnas de autoría. Las fechas las pone `timestamps`. */
const columnasAuditoria = {
    creado_por: {
        type: DataTypes.UUID,
        allowNull: false
    },
    actualizado_por: {
        type: DataTypes.UUID,
        allowNull: false
    }
};

/**
 * Opciones de `define()` que activan las fechas de auditoría con los nombres del
 * modelo canónico en lugar de `createdAt` / `updatedAt`.
 */
const opcionesAuditoria = {
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'ultima_actualizacion'
};

const autorDe = (opciones) => (opciones && opciones.usuarioAuditor) || USUARIO_SISTEMA;

/**
 * Registra los hooks de autoría en un modelo.
 *
 * Van en `beforeValidate` y no en `beforeCreate`/`beforeUpdate` por el orden de
 * ejecución de Sequelize: `beforeValidate` -> validación -> `afterValidate` ->
 * `beforeCreate`. Como las dos columnas son `allowNull: false`, rellenarlas en
 * `beforeCreate` llega tarde y la validación ya falló.
 *
 * `beforeBulkUpdate` importa tanto como el individual: `Inmueble.update(...)`
 * con un `where` no instancia el modelo y se saltaría el hook de instancia.
 */
const registrarHooksAuditoria = (modelo) => {
    modelo.addHook('beforeValidate', (instancia, opciones) => {
        const autor = autorDe(opciones);

        if (instancia.isNewRecord) {
            // Un `creado_por` explícito gana: el autorregistro lo necesita,
            // porque ahí el autor es el propio usuario que se está creando.
            if (!instancia.creado_por) {
                instancia.creado_por = autor;
            }
            instancia.actualizado_por = instancia.creado_por;
            return;
        }

        instancia.actualizado_por = autor;
    });

    modelo.addHook('beforeBulkUpdate', (opciones) => {
        opciones.attributes = { ...opciones.attributes, actualizado_por: autorDe(opciones) };
        // Sin esto Sequelize ignora el atributo que acabamos de añadir, porque
        // `fields` ya venía calculado a partir de los valores originales.
        if (Array.isArray(opciones.fields) && !opciones.fields.includes('actualizado_por')) {
            opciones.fields = [...opciones.fields, 'actualizado_por'];
        }
    });
};

module.exports = { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria };
