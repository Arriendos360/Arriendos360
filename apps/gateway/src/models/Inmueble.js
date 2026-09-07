const { DataTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { claveUuid, referenciaUuid } = require('./uuid');

/**
 * Inmuebles.
 *
 * Los atributos de negocio se conservan tal cual: el modelo canónico los
 * reordena a `alias`/`ciudad`/`tipo`/`descripcion`, pero eso es trabajo del paso
 * 4, cuando se extraiga ms-inmuebles. Aquí sólo cambian el tipo de la clave y la
 * naturaleza de `id_propietario`.
 *
 * `id_propietario` guarda el UUID del usuario como referencia lógica pura: ni
 * clave foránea ni asociación de Sequelize. Ms-identidad ya está extraído, así
 * que esa columna cruza la frontera del servicio y ni la base ni el ORM pueden
 * seguirla. Los datos del propietario, cuando hacen falta, los pide el gateway
 * por HTTP (`clientes/identidad.js`).
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

module.exports = Inmueble;
