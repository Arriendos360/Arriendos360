const { DataTypes } = require('sequelize');
const { ESTADOS_CONTRATO } = require('arriendos360-contracts');

const { sequelize } = require('../config/database');
const { columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } = require('./auditoria');
const { ESTADO_CONTRATO_ACTIVO } = require('./constantes');
const { diaLimiteDesde, fechaInicioCorteDesde } = require('./fechasContrato');
const { claveUuid, referenciaUuid } = require('./uuid');

/**
 * Contratos, ya con los nombres del modelo canónico.
 *
 * `fecha_inicio` → `inicio`, `fecha_fin` → `fin` y `valor_mensual` → `canon`, y
 * `estado` deja de ser un entero. Desde el paso 6b ya no queda nada por alinear:
 * el `url_pdf` suelto se convirtió en la tabla `Anexos`, que es un archivo por
 * fila, con tipo y con auditoría propia. Ver `models/Anexo.js`.
 *
 * `id_inmueble` e `id_inquilino` guardan UUID como referencias lógicas puras,
 * sin asociación de Sequelize: cruzan la frontera hacia ms-inmuebles y
 * ms-identidad. Lo que antes traía un `include` lo compone ahora el gateway por
 * HTTP (`clientes/composicion.js`).
 */
const Contrato = sequelize.define('Contrato', {
    id_contrato: claveUuid(),
    inicio: {
        type: DataTypes.DATE,
        allowNull: false
    },
    fin: {
        type: DataTypes.DATE,
        allowNull: false
    },
    canon: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },

    /**
     * Primera fecha de corte del ciclo de facturación.
     *
     * `DATEONLY` y no `DATE`: es una fecha de calendario, sin hora. Sequelize la
     * devuelve como `'YYYY-MM-DD'`, así que quien la lea obtiene el día que se
     * guardó sin que ninguna zona horaria se lo mueva — que es justo el problema
     * que tendría un `TIMESTAMPTZ` leído con `.getDate()`.
     */
    fecha_inicio_corte: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },

    /**
     * Día del mes en que vence el pago. Un ENTERO, no una fecha; el Capítulo 2
     * lo ejemplifica con `5`.
     *
     * Se guarda tal cual se pactó —un 31 se guarda 31— y el recorte a los meses
     * que no tienen ese día se aplica al resolverlo. Ver `fechasContrato.js`.
     */
    fecha_limite_pago: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
            min: { args: [1], msg: 'La fecha límite de pago debe ser un día del mes (1-31)' },
            max: { args: [31], msg: 'La fecha límite de pago debe ser un día del mes (1-31)' }
        }
    },

    /** Condiciones particulares en texto libre. Opcional. */
    info_contrato: { type: DataTypes.TEXT },

    estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: ESTADO_CONTRATO_ACTIVO,
        validate: {
            isIn: {
                args: [[...ESTADOS_CONTRATO]],
                msg: `El estado del contrato debe ser uno de: ${ESTADOS_CONTRATO.join(', ')}`
            }
        }
    },

    /**
     * Deudor solidario. Los dos opcionales: no todo arriendo tiene codeudor.
     * Exigirlos impediría registrar los que no lo tienen, que son mayoría en
     * arriendos pequeños.
     */
    nombre_deudor_solidario: { type: DataTypes.STRING(150) },
    documento_deudor_solidario: { type: DataTypes.STRING(20) },

    id_inmueble: referenciaUuid(),
    id_inquilino: referenciaUuid(),
    ...columnasAuditoria
}, {
    tableName: 'contratos',
    ...opcionesAuditoria
});

registrarHooksAuditoria(Contrato);

/**
 * Deriva las dos fechas del ciclo de facturación cuando no vienen dadas.
 *
 * VA EN UN HOOK Y NO EN EL CONTROLADOR a propósito. Las dos columnas son
 * `NOT NULL`, así que el invariante «un contrato siempre tiene fecha de corte y
 * día límite» es del modelo; dejarlo en el controlador significaría que
 * cualquier otro camino de escritura —el motor financiero, una migración de
 * datos, el `ms-contratos` del paso 6d— tendría que acordarse de repetirlo, y el
 * día que se olvide falla el `INSERT` en vez de derivarse solo.
 *
 * SÓLO SI NO VIENEN. Un valor explícito gana siempre: es lo que permite que el
 * formulario ofrezca el día límite como sugerencia editable, y lo que deja la
 * puerta abierta a renegociar el ciclo sin tocar la fecha de inicio del
 * contrato. Derivar en lectura habría cerrado esa puerta.
 *
 * Va en `beforeValidate` por lo mismo que los hooks de auditoría: las columnas
 * son `allowNull: false` y rellenarlas después de la validación llega tarde.
 */
Contrato.addHook('beforeValidate', (contrato) => {
    if (!contrato.isNewRecord || !contrato.inicio) {
        return;
    }

    if (!contrato.fecha_inicio_corte) {
        contrato.fecha_inicio_corte = fechaInicioCorteDesde(contrato.inicio);
    }

    if (contrato.fecha_limite_pago === null || contrato.fecha_limite_pago === undefined) {
        contrato.fecha_limite_pago = diaLimiteDesde(contrato.inicio);
    }
});

// Ni `id_inmueble` ni `id_inquilino` tienen asociación: los dos cruzan la
// frontera de un servicio —ms-inmuebles y ms-identidad— y la regla dura 2
// prohíbe que un `include` la atraviese. Son referencias lógicas puras: UUID sin
// clave foránea y sin nada que el ORM pueda seguir.

module.exports = Contrato;
