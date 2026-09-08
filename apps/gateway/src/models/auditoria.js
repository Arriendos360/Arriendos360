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
 *
 * Y desde el paso 5 hay un tercer origen: un consumidor de eventos, que tampoco
 * es una persona y también cae en USUARIO_SISTEMA. Eso NO deja el rastro roto —
 * el evento identifica la causa y el agregado del emisor guarda a quien la
 * provocó. La cadena completa está escrita en `docs/adr/0011`.
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
 * SON TRES HOOKS PORQUE HAY TRES CAMINOS DE ESCRITURA, y cada uno llega a las
 * columnas de autoría por un sitio distinto. Escribirlo en uno solo fue el
 * defecto que este archivo tuvo hasta ahora.
 *
 * **`beforeValidate` — el alta.** Tiene que ser aquí y no en `beforeCreate` por
 * el orden de ejecución de Sequelize: `beforeValidate` -> validación ->
 * `afterValidate` -> `beforeCreate`. Como las dos columnas son
 * `allowNull: false`, rellenarlas en `beforeCreate` llega tarde y la validación
 * ya falló.
 *
 * **`beforeUpdate` — la modificación de una instancia.** Y NO vale hacerlo
 * también en `beforeValidate`, que es lo que hacía antes. `instancia.update(v)`
 * decide qué columnas va a escribir a partir de las claves de `v` ANTES de
 * disparar ningún hook; después recupera lo que hayan cambiado los hooks de
 * guardado —`beforeUpdate`, `beforeSave`— pero descarta expresamente lo que ya
 * estuviera marcado como cambiado antes de empezar. Tocarlo en `beforeValidate`
 * caía justo en esa excepción: la instancia se quedaba con el valor nuevo en
 * memoria y el `UPDATE` salía sin la columna.
 *
 * El síntoma era mudo. `actualizado_por` conservaba para siempre el valor que
 * tomó en el alta, en `contratos`, `pagos` y `abonos` a la vez, y no lo delataba
 * ninguna prueba porque las que existían comparaban contra el propio creador —
 * que es el valor que el defecto dejaba ahí. Ver `tests/auditoria.test.js`.
 *
 * **`beforeBulkUpdate` — la actualización masiva.** `Modelo.update(...)` con un
 * `where` no instancia el modelo y se saltaría los otros dos. Hoy no lo usa
 * nadie en el gateway: se escribió para `Inmueble.update(...)`, que se fue con
 * ms-inmuebles en el paso 4. Se conserva igualmente, porque cuesta nada y
 * porque el día que alguien escriba `Pago.update({...}, { where })` la columna
 * tiene que salir correcta sin que haya que acordarse de esto.
 */
const registrarHooksAuditoria = (modelo) => {
    modelo.addHook('beforeValidate', (instancia, opciones) => {
        if (!instancia.isNewRecord) {
            return;
        }

        // Un `creado_por` explícito gana: el autorregistro lo necesita, porque
        // ahí el autor es el propio usuario que se está creando.
        if (!instancia.creado_por) {
            instancia.creado_por = autorDe(opciones);
        }
        instancia.actualizado_por = instancia.creado_por;
    });

    modelo.addHook('beforeUpdate', (instancia, opciones) => {
        // Una línea igual que la de arriba. Lo que la hace funcionar no es CÓMO
        // se asigna —da lo mismo, Sequelize pasa por el setter en los dos
        // casos— sino DÓNDE: en `beforeUpdate`, no en `beforeValidate`. Ver la
        // cabecera de esta función.
        instancia.actualizado_por = autorDe(opciones);
    });

    modelo.addHook('beforeBulkUpdate', (opciones) => {
        opciones.attributes = { ...opciones.attributes, actualizado_por: autorDe(opciones) };
        // Sin esto Sequelize ignora el atributo que acabamos de añadir, porque
        // `fields` ya venía calculado a partir de los valores originales. Es la
        // misma trampa que arriba, en la versión masiva.
        if (Array.isArray(opciones.fields) && !opciones.fields.includes('actualizado_por')) {
            opciones.fields = [...opciones.fields, 'actualizado_por'];
        }
    });
};

module.exports = { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria };
