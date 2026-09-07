const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { claveUuid, referenciaUuid } = require('./uuid');
const Usuario = require('./Usuario');

/**
 * Inmuebles.
 *
 * Los atributos de negocio se conservan tal cual: el modelo canónico los
 * reordena a `alias`/`ciudad`/`tipo`/`descripcion`, pero eso es trabajo del paso
 * 4, cuando se extraiga ms-inmuebles. Aquí sólo cambian el tipo de la clave y la
 * naturaleza de `id_propietario`.
 *
 * `id_propietario` guardaba la CÉDULA del propietario y apuntaba a la tabla
 * `propietarios`, que ya no existe. Ahora guarda el UUID del usuario, como
 * referencia lógica sin clave foránea: al extraer ms-inmuebles, esa columna
 * cruzará a ms-identidad y la regla dura 1 prohíbe la FK.
 */
const Inmueble = sequelize.define('Inmueble', {
    id_inmueble: claveUuid(),
    departamento: { type: DataTypes.STRING(100) },
    municipio: { type: DataTypes.STRING(100) },
    barrio: { type: DataTypes.STRING(100) },
    direccion: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    tipo_inmueble: { type: DataTypes.STRING(50) },
    area_m2: { type: DataTypes.DECIMAL(10, 2) },
    habitaciones: { type: DataTypes.INTEGER },
    banos: { type: DataTypes.INTEGER },
    deposito: { type: DataTypes.INTEGER },
    parqueaderos: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    estrato: { type: DataTypes.INTEGER },
    estado_ocupacion: {
        type: DataTypes.STRING(20),
        defaultValue: 'disponible'
    },
    id_propietario: referenciaUuid(),
    ...columnasAuditoria
}, {
    tableName: 'inmuebles',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Inmueble);

// El alias `Propietario` mantiene el nombre que ya usaban los controladores y
// los PDF (`inmueble.Propietario.nombres`), pero ahora apunta a `Usuario`.
// `constraints: false` deja constancia de que la referencia es lógica.
Inmueble.belongsTo(Usuario, {
    foreignKey: 'id_propietario',
    as: 'Propietario',
    constraints: false
});
Usuario.hasMany(Inmueble, {
    foreignKey: 'id_propietario',
    as: 'Inmuebles',
    constraints: false
});

module.exports = Inmueble;
