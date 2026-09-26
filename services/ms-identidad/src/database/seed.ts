/**
 * Usuarios de prueba para desarrollo y demostración. Idempotente: no recrea un
 * email que ya existe.
 *
 * Uso:
 *   npm run seed --workspace=services/ms-identidad
 *   docker exec arriendos360_identidad npm run seed
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { sequelize } from '../config/database';
import { ROLES, ROL_INQUILINO, ROL_PROPIETARIO, USUARIO_SISTEMA } from '../models/constantes';
import { RolUsuario } from '../models/RolUsuario';
import { Usuario } from '../models/Usuario';
import { aplicarMigraciones } from './migraciones';

export const CONTRASENA = 'Prueba123';

interface DefinicionUsuario {
  nombres: string;
  apellidos: string;
  email: string;
  telefono: string;
  documento: string;
  roles: string[];
}

/** Un propietario, un inquilino y un usuario con los dos roles. */
export const USUARIOS: DefinicionUsuario[] = [
  {
    nombres: 'Ana',
    apellidos: 'Propietaria',
    email: 'propietario@arriendos360.test',
    telefono: '3001111111',
    documento: '10000001',
    roles: [ROL_PROPIETARIO],
  },
  {
    nombres: 'Bruno',
    apellidos: 'Inquilino',
    email: 'inquilino@arriendos360.test',
    telefono: '3002222222',
    documento: '10000002',
    roles: [ROL_INQUILINO],
  },
  {
    nombres: 'Carmen',
    apellidos: 'Ambos',
    email: 'ambos@arriendos360.test',
    telefono: '3003333333',
    documento: '10000003',
    roles: [ROL_PROPIETARIO, ROL_INQUILINO],
  },
];

const sembrarUsuario = async (
  definicion: DefinicionUsuario,
): Promise<{ usuario: Usuario; creado: boolean }> => {
  const existente = await Usuario.findOne({ where: { email: definicion.email } });
  if (existente) {
    return { usuario: existente, creado: false };
  }

  const idUsuario = crypto.randomUUID();
  const contrasena = await bcrypt.hash(CONTRASENA, 10);

  const usuario = await sequelize.transaction(async (transaccion) => {
    const nuevo = await Usuario.create(
      {
        id_usuario: idUsuario,
        nombres: definicion.nombres,
        apellidos: definicion.apellidos,
        email: definicion.email,
        contrasena,
        telefono: definicion.telefono,
        documento: definicion.documento,
        creado_por: USUARIO_SISTEMA,
      },
      { transaction: transaccion, usuarioAuditor: USUARIO_SISTEMA } as never,
    );

    for (const rol of definicion.roles) {
      await RolUsuario.create(
        { id_rol: ROLES[rol], id_usuario: idUsuario, creado_por: USUARIO_SISTEMA },
        { transaction: transaccion, usuarioAuditor: USUARIO_SISTEMA } as never,
      );
    }

    return nuevo;
  });

  return { usuario, creado: true };
};

export const sembrar = async (): Promise<
  Array<{ email: string; documento: string; id: string; roles: string; estado: string }>
> => {
  await aplicarMigraciones(sequelize);

  const resumen = [];
  for (const definicion of USUARIOS) {
    const { usuario, creado } = await sembrarUsuario(definicion);
    resumen.push({
      email: usuario.email,
      documento: usuario.documento,
      id: usuario.id_usuario,
      roles: definicion.roles.join(', '),
      estado: creado ? 'creado' : 'ya existía',
    });
  }

  return resumen;
};

if (require.main === module) {
  sembrar()
    .then((resumen) => {
      console.table(resumen);
      console.log(`\nContraseña de todos los usuarios de prueba: ${CONTRASENA}`);
      return sequelize.close();
    })
    .catch(async (error) => {
      console.error('❌ Error al sembrar:', error);
      await sequelize.close();
      process.exit(1);
    });
}
