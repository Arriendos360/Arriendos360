import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { CANAL_EMAIL, ENVIO_PENDIENTE, ESTADOS_ENVIO } from './constantes';

/**
 * La bitacora de envios: un correo por fila, desde que se redacta hasta que sale.
 *
 * ── ES UN OUTBOX DE CORREOS, Y ESA ES LA IDEA ENTERA ────────────────────────
 *
 * El bus resolvio «guardar y avisar no caben en la misma operacion» escribiendo el
 * aviso como una fila en la misma transaccion que el cambio de dominio. Aqui el
 * problema es el mismo un piso mas abajo: procesar el evento y mandar el correo no
 * caben en la misma transaccion, porque un `sendMail` no se puede deshacer con un
 * ROLLBACK.
 *
 * Y la solucion es la misma. El manejador del evento no envia: redacta y deja la
 * fila `pendiente`, en la MISMA transaccion en la que el consumidor anota el
 * `id_evento` en `eventos_procesados`. El `sendMail` lo hace despues un barrido
 * aparte (`services/enviador.ts`).
 *
 * De ahi salen las dos garantias que importan:
 *
 *   * **Un evento repetido no produce un segundo correo.** No porque el enviador
 *     lo detecte, sino porque la fila no llega a existir: la marca del evento ya
 *     estaba y el manejador no corrio.
 *   * **Un fallo de envio se ve.** Queda en `ultimo_error` de una fila que se
 *     puede consultar, en vez de en un `console.error` que nadie lee. Es lo que
 *     hace honesta la respuesta de `/recuperar`.
 *
 * ── NO LLEVA COLUMNAS DE AUDITORIA, Y NO ES UN OLVIDO ──────────────────────
 *
 * CLAUDE.md las exige a toda tabla de DOMINIO. Esta no lo es, y ademas no habria
 * nada que poner: el sobre del evento no lleva actor a proposito, asi que la
 * persona que provoco el hecho no esta disponible aqui. Quien lo provoco esta en
 * el agregado del emisor, y `id_evento` es el eslabon que lleva hasta alli. Ver
 * `docs/adr/0011`.
 */
export class Envio extends Model {
  declare id_envio: string;
  declare id_evento: string;
  declare tipo_evento: string;
  declare id_usuario: string;
  declare destinatario: string;
  declare canal: string;
  declare asunto: string;
  declare cuerpo: string | null;
  declare estado: string;
  declare intentos: number;
  declare proximo_intento_en: Date;
  declare ultimo_error: string | null;
  declare enviado_en: Date | null;
  declare registrado_en: Date;
}

Envio.init(
  {
    /**
     * UUID generado en la aplicacion, no por la base.
     *
     * Es la convencion del proyecto —«los servicios necesitan conocer el ID antes
     * de publicar un evento»— y aqui vale un matiz: este servicio no publica
     * nada, pero el enviador necesita poder decir «tome esta fila» sin volver a
     * consultarla, y para eso tiene que conocer su identificador.
     */
    id_envio: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },

    /**
     * El evento que lo provoco. NO es unico: un evento puede producir dos envios
     * —`CuentaCobroEnMora` avisa al inquilino y al propietario— y los dos se
     * redactan en la misma transaccion.
     */
    id_evento: { type: DataTypes.UUID, allowNull: false },
    tipo_evento: { type: DataTypes.STRING(80), allowNull: false },

    /**
     * A quien se quiso avisar y a donde salio, que son dos preguntas distintas.
     *
     * `id_usuario` venia en el sobre; `destinatario` es lo que ms-identidad
     * contesto al preguntarle. Guardar los dos es lo que permite que la bitacora
     * siga siendo cierta cuando alguien cambie su correo: dira a que direccion se
     * entrego esto, no a cual se entregaria hoy.
     */
    id_usuario: { type: DataTypes.UUID, allowNull: false },
    destinatario: { type: DataTypes.STRING(255), allowNull: false },

    canal: { type: DataTypes.STRING(20), allowNull: false, defaultValue: CANAL_EMAIL },

    asunto: { type: DataTypes.STRING(255), allowNull: false },

    /**
     * El cuerpo ya redactado. SE BORRA AL MARCAR LA FILA COMO ENVIADA.
     *
     * Por la misma razon que el payload de `identidad.eventos_salida`: el correo de
     * recuperacion lleva un enlace con el token en claro, y conservarlo aqui para
     * siempre seria dejar la llave debajo del felpudo. El borrado va en la MISMA
     * sentencia que la marca, no en una segunda operacion — ver `enviador.ts`.
     *
     * De ahi que sea NULL-able: una fila `enviado` no tiene cuerpo, y eso es lo
     * correcto. Lo que se audita es a quien, cuando, con que asunto y si funciono.
     */
    cuerpo: { type: DataTypes.TEXT },

    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: ENVIO_PENDIENTE,
      validate: { isIn: [[...ESTADOS_ENVIO]] },
    },

    intentos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    proximo_intento_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    ultimo_error: { type: DataTypes.TEXT },
    enviado_en: { type: DataTypes.DATE },
    registrado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'Envio',
    tableName: 'envios',
    // Las marcas de tiempo que hacen falta son explicitas —`registrado_en`,
    // `enviado_en`— y dicen algo concreto. `createdAt`/`updatedAt` genericos
    // sobrarian y ademas no existen en la migracion.
    timestamps: false,
  },
);
