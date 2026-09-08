import { DataTypes, Model } from 'sequelize';
import { ESTADOS_CONTRATO } from 'arriendos360-contracts';
import { diaLimiteDesde, fechaInicioCorteDesde } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';
import { ESTADO_CONTRATO_ACTIVO } from './constantes';

/**
 * Contratos, con los nombres del modelo canonico.
 *
 * `id_inmueble` e `id_inquilino` guardan UUID como referencias logicas puras,
 * sin clave foranea y sin asociacion: cruzan la frontera hacia ms-inmuebles y
 * ms-identidad (regla dura 1). Lo que haga falta de ellos se pide por HTTP.
 *
 * ── NO HAY `id_propietario`, Y ES UNA DECISION ──────────────────────────────
 *
 * La cabecera del viejo `anexo.controller.js` del gateway recomendaba
 * denormalizarlo aqui para que el ABAC de los anexos quedara local y la descarga
 * no tuviera saltos de red. Se decidio que no: el dueño de un inmueble puede
 * cambiar, y de ese dato depende TODA la autorizacion de este servicio. Una
 * copia obsoleta daria acceso al propietario anterior y se lo negaria al nuevo,
 * en silencio y sin nada que lo delate. La pertenencia se le pregunta a
 * ms-inmuebles, que es quien la sabe. Ver `docs/adr/0017`.
 */
export class Contrato extends Model {
  declare id_contrato: string;
  declare inicio: Date | string;
  declare fin: Date | string;
  declare canon: number | string;
  declare fecha_inicio_corte: string;
  declare fecha_limite_pago: number;
  declare info_contrato: string | null;
  declare estado: string;
  declare nombre_deudor_solidario: string | null;
  declare documento_deudor_solidario: string | null;
  declare id_inmueble: string;
  declare id_inquilino: string;
  declare creado_por: string;
  declare actualizado_por: string;
}

Contrato.init(
  {
    id_contrato: claveUuid(),
    inicio: { type: DataTypes.DATE, allowNull: false },
    fin: { type: DataTypes.DATE, allowNull: false },
    canon: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

    /**
     * Primera fecha de corte del ciclo de facturacion.
     *
     * `DATEONLY` y no `DATE`: es una fecha de calendario, sin hora. Sequelize la
     * devuelve como `'YYYY-MM-DD'`, asi que quien la lea obtiene el dia que se
     * guardo sin que ninguna zona horaria se lo mueva — que es justo el problema
     * que tendria un `TIMESTAMPTZ` leido con `.getDate()`.
     */
    fecha_inicio_corte: { type: DataTypes.DATEONLY, allowNull: false },

    /**
     * Dia del mes en que vence el pago. Un ENTERO, no una fecha.
     *
     * Se guarda tal cual se pacto —un 31 se guarda 31— y el recorte a los meses
     * que no tienen ese dia se aplica al resolverlo. Ver `fechas` en
     * `packages/shared`.
     */
    fecha_limite_pago: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: { args: [1], msg: 'La fecha límite de pago debe ser un día del mes (1-31)' },
        max: { args: [31], msg: 'La fecha límite de pago debe ser un día del mes (1-31)' },
      },
    },

    /** Condiciones particulares en texto libre. Opcional. */
    info_contrato: { type: DataTypes.TEXT, allowNull: true },

    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: ESTADO_CONTRATO_ACTIVO,
      validate: {
        isIn: {
          args: [[...ESTADOS_CONTRATO]],
          msg: `El estado del contrato debe ser uno de: ${ESTADOS_CONTRATO.join(', ')}`,
        },
      },
    },

    /**
     * Deudor solidario. Los dos opcionales: no todo arriendo tiene codeudor, y
     * exigirlos impediria registrar los que no lo tienen, que son mayoria en
     * arriendos pequeños.
     */
    nombre_deudor_solidario: { type: DataTypes.STRING(150), allowNull: true },
    documento_deudor_solidario: { type: DataTypes.STRING(20), allowNull: true },

    id_inmueble: { type: DataTypes.UUID, allowNull: false },
    id_inquilino: { type: DataTypes.UUID, allowNull: false },
    ...columnasAuditoria,
  },
  {
    sequelize,
    modelName: 'Contrato',
    tableName: 'contratos',
    ...opcionesAuditoria,
  },
);

registrarHooksAuditoria(Contrato);

/**
 * Deriva las dos fechas del ciclo de facturacion cuando no vienen dadas.
 *
 * VA EN UN HOOK Y NO EN EL CONTROLADOR a proposito. Las dos columnas son
 * `NOT NULL`, asi que el invariante «un contrato siempre tiene fecha de corte y
 * dia limite» es del modelo; dejarlo en el controlador significaria que
 * cualquier otro camino de escritura —una migracion de datos, un proceso
 * futuro— tendria que acordarse de repetirlo, y el dia que se olvide falla el
 * `INSERT` en vez de derivarse solo.
 *
 * SOLO SI NO VIENEN. Un valor explicito gana siempre: es lo que permite que el
 * formulario ofrezca el dia limite como sugerencia editable, y lo que deja la
 * puerta abierta a renegociar el ciclo sin tocar la fecha de inicio del
 * contrato. Derivar en lectura habria cerrado esa puerta.
 *
 * Va en `beforeValidate` por lo mismo que los hooks de auditoria: las columnas
 * son `allowNull: false` y rellenarlas despues de la validacion llega tarde.
 */
Contrato.addHook('beforeValidate', (instancia) => {
  const contrato = instancia as Contrato;

  if (!contrato.isNewRecord || !contrato.getDataValue('inicio')) {
    return;
  }

  const inicio = contrato.getDataValue('inicio');

  if (!contrato.getDataValue('fecha_inicio_corte')) {
    const derivada = fechaInicioCorteDesde(inicio);
    if (derivada !== null) {
      contrato.setDataValue('fecha_inicio_corte', derivada);
    }
  }

  const limite = contrato.getDataValue('fecha_limite_pago');
  if (limite === null || limite === undefined) {
    const derivado = diaLimiteDesde(inicio);
    if (derivado !== null) {
      contrato.setDataValue('fecha_limite_pago', derivado);
    }
  }
});
