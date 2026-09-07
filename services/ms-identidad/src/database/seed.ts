/**
 * Datos de prueba para desarrollo y demo.
 *
 * Vivia en el gateway hasta que la identidad se extrajo. Ahora es de este
 * servicio, que es quien posee `usuarios` y `roles_usuario`: sembrar usuarios
 * desde fuera exigiria escribir en un esquema ajeno, que es justo lo que la
 * regla dura 3 prohibe.
 *
 * Uso:
 *   npm run seed --workspace=services/ms-identidad
 *   docker exec arriendos360_identidad npm run seed
 *
 * Es idempotente: si el email ya existe, no lo vuelve a crear.
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

/**
 * El tercer usuario tiene los dos roles a la vez. No es un capricho: es el caso
 * que el modelo viejo NO podia representar, porque `usuarios.rol` era una sola
 * columna. Sirve para comprobar que el arreglo `roles` de los claims y las
 * consultas por pertenencia hacen lo correcto.
 */
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
      // El gateway ya no puede resolver un usuario por su cedula desde SQL, asi
      // que el UUID se imprime: es lo que se necesita para armar datos a mano.
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
