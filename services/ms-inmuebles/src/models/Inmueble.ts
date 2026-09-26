import { DataTypes, Model } from 'sequelize';
import { ESTADOS_INMUEBLE, LONGITUD_MAXIMA_ALIAS, TIPOS_INMUEBLE } from 'arriendos360-contracts';
import type { EstadoInmueble, TipoInmueble } from 'arriendos360-contracts';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';
import { ESTADO_INICIAL } from './constantes';

/**
 * Tabla `Inmuebles`. `tipo` y `estado` se validan contra los catálogos aquí y con
 * un `CHECK` en la base. `id_propietario` es una referencia sin clave foránea.
 */
export class Inmueble extends Model {
  declare id_inmueble: string;
  /** Nombre corto con el que el propietario reconoce el inmueble. */
  declare alias: string;
  declare departamento: string | null;
  declare ciudad: string | null;
  declare barrio: string | null;
  declare direccion: string;
  declare descripcion: string | null;
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
    alias: { type: DataTypes.STRING(LONGITUD_MAXIMA_ALIAS), allowNull: false },
    departamento: { type: DataTypes.STRING(100) },
    ciudad: { type: DataTypes.STRING(100) },
    barrio: { type: DataTypes.STRING(100) },
    direccion: { type: DataTypes.STRING(255), allowNull: false },
    descripcion: { type: DataTypes.TEXT },
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
