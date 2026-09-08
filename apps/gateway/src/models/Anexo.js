const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const Contrato = require('./Contrato');
const { claveUuid } = require('./uuid');

/**
 * Anexos: los archivos que acompañan a un contrato.
 *
 * Octava tabla del modelo canónico y la última que le faltaba a Contratos.
 * Sustituye a `contratos.url_pdf`, que era un archivo por contrato y una ruta de
 * disco escrita a mano.
 *
 * `archivo_anexo` NO es una ruta: es la referencia que devuelve el
 * almacenamiento, y sólo él sabe interpretarla. Ver `services/almacenamiento.js`.
 *
 * `tipo` es un enum ABIERTO. El Capítulo 2 enumera `CONTRATO_FIRMADO` y `OTROSI`
 * seguidos de "etc.", así que no hay `isIn` ni `CHECK`: los valores conocidos
 * viven en `packages/contracts` como sugerencia. Es deliberadamente distinto de
 * `inmuebles.tipo`, que sí es un catálogo cerrado — allí la lista está fijada y
 * un valor nuevo es un error; aquí un otrosí de una modalidad que nadie previó
 * no puede quedar bloqueado por una migración.
 */
const Anexo = sequelize.define('Anexo', {
    id_anexo: claveUuid(),
    archivo_anexo: {
        type: DataTypes.STRING(500),
        allowNull: false
    },
    tipo: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    id_contrato: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: Contrato, key: 'id_contrato' }
    },
    ...columnasAuditoria
}, {
    tableName: 'anexos',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Anexo);

/**
 * ÉSTA SÍ es una asociación de verdad, y es la única de este archivo.
 *
 * `Anexos` y `Contratos` son las dos tablas de ms-contratos: se mudan juntas en
 * el paso 6d, así que la clave foránea no cruza la frontera de ningún servicio y
 * la regla dura 1 no aplica. Es el mismo caso que `abonos` con `pagos`.
 */
Anexo.belongsTo(Contrato, { foreignKey: 'id_contrato' });
Contrato.hasMany(Anexo, { foreignKey: 'id_contrato' });

module.exports = Anexo;
