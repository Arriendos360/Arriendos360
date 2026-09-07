const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { claveUuid, referenciaUuid } = require('./uuid');
const Inmueble = require('./Inmueble');
const Usuario = require('./Usuario');

/**
 * Contratos.
 *
 * Igual que en Inmuebles, los nombres de negocio no se tocan: `valor_mensual`
 * pasará a `canon` y aparecerán `fecha_inicio_corte`, `fecha_limite_pago` y los
 * datos del deudor solidario cuando se extraiga ms-contratos (paso 6).
 *
 * `id_inquilino` guardaba la CÉDULA y apuntaba a la tabla `inquilinos`, que ya
 * no existe. Ahora guarda el UUID del usuario.
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

// Referencias lógicas: `id_inmueble` cruzará a ms-inmuebles e `id_inquilino` a
// ms-identidad. El `include` sigue funcionando mientras esto sea un monolito;
// el paso 6 lo reemplaza por llamadas HTTP (regla dura 2).
Contrato.belongsTo(Inmueble, { foreignKey: 'id_inmueble', constraints: false });
Inmueble.hasMany(Contrato, { foreignKey: 'id_inmueble', constraints: false });

Contrato.belongsTo(Usuario, {
    foreignKey: 'id_inquilino',
    as: 'Inquilino',
    constraints: false
});
Usuario.hasMany(Contrato, {
    foreignKey: 'id_inquilino',
    as: 'ContratosComoInquilino',
    constraints: false
});

module.exports = Contrato;
