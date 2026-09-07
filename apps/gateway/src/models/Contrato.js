const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { claveUuid, referenciaUuid } = require('./uuid');
const Inmueble = require('./Inmueble');

/**
 * Contratos.
 *
 * Igual que en Inmuebles, los nombres de negocio no se tocan: `valor_mensual`
 * pasará a `canon` y aparecerán `fecha_inicio_corte`, `fecha_limite_pago` y los
 * datos del deudor solidario cuando se extraiga ms-contratos (paso 6).
 *
 * `id_inquilino` guarda el UUID del usuario como referencia lógica pura, sin
 * asociación de Sequelize: cruza la frontera hacia ms-identidad. El nombre del
 * inquilino que el listado muestra ya no sale de un `include`, lo compone el
 * gateway pidiéndoselo al servicio.
 */
const Contrato = sequelize.define('Contrato', {
    id_contrato: claveUuid(),
    fecha_inicio: {
        type: DataTypes.DATE,
        allowNull: false
    },
    fecha_fin: {
        type: DataTypes.DATE,
        allowNull: false
    },
    valor_mensual: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    deposito: { type: DataTypes.DECIMAL(12, 2) },
    estado: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    url_pdf: { type: DataTypes.STRING(500) },
    inventario_fotografico: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    id_inmueble: referenciaUuid(),
    id_inquilino: referenciaUuid(),
    ...columnasAuditoria
}, {
    tableName: 'contratos',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Contrato);

// `id_inmueble` sigue teniendo asociación porque Inmuebles todavía vive en el
// gateway; el paso 4 la sustituirá por composición, igual que se acaba de hacer
// con el inquilino. `id_inquilino` ya no la tiene: cruza a ms-identidad.
Contrato.belongsTo(Inmueble, { foreignKey: 'id_inmueble', constraints: false });
Inmueble.hasMany(Contrato, { foreignKey: 'id_inmueble', constraints: false });

module.exports = Contrato;
