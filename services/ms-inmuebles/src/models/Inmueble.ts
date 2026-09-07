import { DataTypes, Model } from 'sequelize';
import { ESTADOS_INMUEBLE, TIPOS_INMUEBLE } from 'arriendos360-contracts';
import type { EstadoInmueble, TipoInmueble } from 'arriendos360-contracts';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';
import { ESTADO_INICIAL } from './constantes';

/**
 * Tabla `Inmuebles` del modelo canonico.
 *
 * DOS DIFERENCIAS con la version que tenia el gateway:
 *
 * - `estado_ocupacion` se llama ahora `estado`, como en el Capitulo 2.
 * - `tipo_inmueble` se llama `tipo` y es un catalogo cerrado. Era
 *   `VARCHAR(50)` libre, y la base acumulaba "Casa", "casa" y "Apto" como
 *   valores distintos.
 *
 * `id_propietario` guarda el UUID del usuario como referencia logica pura: ni
 * clave foranea ni asociacion de Sequelize. Vive en ms-identidad, asi que esa
 * columna cruza la frontera del servicio y ni la base ni el ORM pueden
 * seguirla. Quien necesite los datos del propietario los compone por HTTP.
 *
 * La validacion del catalogo va DOS veces: aqui, con `isIn`, y en la base, con
 * un CHECK. No es celo. El `isIn` da un 400 con un mensaje que se puede leer;
 * el CHECK es lo que impide que una migracion futura, un `INSERT` a mano o un
 * bug en otro camino metan basura. El de la base es el que manda.
 */
export class Inmueble extends Model {
  declare id_inmueble: string;
  declare departamento: string | null;
  declare municipio: string | null;
  declare barrio: string | null;
  declare direccion: string;
  declare tipo: TipoInmueble;
  declare area_m2: string | null;
  declare habitaciones: number | null;
  declare banos: number | null;
  declare deposito: number | null;
  declare parqueaderos: number | null;
  declare estrato: number | null;
  declare estado: EstadoInmueble;
  /** UUID del usuario propietario. Referencia logica, sin FK. */
  declare id_propietario: string;
  declare creado_por: string;
  declare actualizado_por: string;
}

Inmueble.init(
  {
    id_inmueble: claveUuid(),
    departamento: { type: DataTypes.STRING(100) },
    municipio: { type: DataTypes.STRING(100) },
    barrio: { type: DataTypes.STRING(100) },
    direccion: { type: DataTypes.STRING(255), allowNull: false },
    tipo: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: {
          args: [[...TIPOS_INMUEBLE]],
          msg: `El tipo debe ser uno de: ${TIPOS_INMUEBLE.join(', ')}`,
        },
      },
    },
    area_m2: { type: DataTypes.DECIMAL(10, 2) },
    habitaciones: { type: DataTypes.INTEGER },
    banos: { type: DataTypes.INTEGER },
    deposito: { type: DataTypes.INTEGER },
    parqueaderos: { type: DataTypes.INTEGER, defaultValue: 0 },
    estrato: { type: DataTypes.INTEGER },
    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: ESTADO_INICIAL,
      validate: {
        isIn: {
          args: [[...ESTADOS_INMUEBLE]],
          msg: `El estado debe ser uno de: ${ESTADOS_INMUEBLE.join(', ')}`,
        },
      },
    },
    id_propietario: { type: DataTypes.UUID, allowNull: false },
    ...columnasAuditoria,
  },
  { sequelize, tableName: 'inmuebles', ...opcionesAuditoria },
);

registrarHooksAuditoria(Inmueble);
