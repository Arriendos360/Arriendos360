import { DataTypes, Model } from 'sequelize';

import { sequelize } from '../config/database';
import { claveUuid, columnasAuditoria, opcionesAuditoria, registrarHooksAuditoria } from './columnas';

/**
 * Tabla `Usuarios` del modelo canonico.
 *
 * Sustituye a la trinidad `Usuario` + `Propietario` + `Inquilino` del monolito.
 * La distincion entre propietario e inquilino no es una tabla ni una columna:
 * es una fila en `RolesUsuario`, y por eso un mismo usuario puede ser las dos
 * cosas.
 */
export class Usuario extends Model {
  declare id_usuario: string;
  declare nombres: string;
  declare apellidos: string;
  declare email: string;
  /** Hash bcrypt. El nombre de la columna es el del modelo canonico. */
  declare contrasena: string;
  declare telefono: string | null;
  declare documento: string;
  /** Marca a quien no eligio su propia contrasena. Ver docs/adr/0007. */
  declare debe_cambiar_contrasena: boolean;
  declare creado_por: string;
  declare actualizado_por: string;
}

Usuario.init(
  {
    id_usuario: claveUuid(),
    nombres: { type: DataTypes.STRING(100), allowNull: false },
    apellidos: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(150), allowNull: false, unique: true },
    contrasena: { type: DataTypes.STRING(255), allowNull: false },
    telefono: { type: DataTypes.STRING(15) },
    documento: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    debe_cambiar_contrasena: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    ...columnasAuditoria,
  },
  { sequelize, tableName: 'usuarios', ...opcionesAuditoria },
);

registrarHooksAuditoria(Usuario);
