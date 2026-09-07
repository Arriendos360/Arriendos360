/**
 * Datos de prueba para desarrollo y demo.
 *
 * Vive junto al runner y no en `database/`, por la misma razón: necesita bcrypt
 * y los modelos, así que es código, no datos. Los `.sql` de `database/` sí son
 * datos puros y se quedan allí. Los roles del catálogo tampoco están aquí: son
 * la migración `identidad/002_roles_base.sql`, porque la aplicación no funciona
 * sin ellos.
 *
 * Uso:
 *   npm run seed --workspace=apps/gateway
 *
 * Es idempotente: si el email ya existe, no lo vuelve a crear. Se puede correr
 * las veces que haga falta sobre la misma base.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { sequelize } = require('../config/database');
const { ROLES, ROL_INQUILINO, ROL_PROPIETARIO, USUARIO_SISTEMA } = require('../models/constantes');
const RolUsuario = require('../models/RolUsuario');
const Usuario = require('../models/Usuario');
const { aplicarMigraciones } = require('./migraciones');

const CONTRASENA = 'Prueba123';

/**
 * El tercer usuario tiene los dos roles a la vez. No es un capricho del seed: es
 * el caso que el modelo viejo NO podía representar, porque `usuarios.rol` era
 * una sola columna y `propietarios`/`inquilinos` eran tablas separadas. Sirve
 * para comprobar que el arreglo `roles` de los claims y las consultas por
 * pertenencia (dueño O inquilino) hacen lo correcto.
 */
const USUARIOS = [
    {
        nombres: 'Ana',
        apellidos: 'Propietaria',
        email: 'propietario@arriendos360.test',
        telefono: '3001111111',
        documento: '10000001',
        roles: [ROL_PROPIETARIO]
    },
    {
        nombres: 'Bruno',
        apellidos: 'Inquilino',
        email: 'inquilino@arriendos360.test',
        telefono: '3002222222',
        documento: '10000002',
        roles: [ROL_INQUILINO]
    },
    {
        nombres: 'Carmen',
        apellidos: 'Ambos',
        email: 'ambos@arriendos360.test',
        telefono: '3003333333',
        documento: '10000003',
        roles: [ROL_PROPIETARIO, ROL_INQUILINO]
    }
];

const sembrarUsuario = async (definicion) => {
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
                creado_por: USUARIO_SISTEMA
            },
            { transaction: transaccion, usuarioAuditor: USUARIO_SISTEMA }
        );

        for (const rol of definicion.roles) {
            await RolUsuario.create(
                { id_rol: ROLES[rol], id_usuario: idUsuario, creado_por: USUARIO_SISTEMA },
                { transaction: transaccion, usuarioAuditor: USUARIO_SISTEMA }
            );
        }

        return nuevo;
    });

    return { usuario, creado: true };
};

const sembrar = async () => {
    await aplicarMigraciones(sequelize);

    const resumen = [];
    for (const definicion of USUARIOS) {
        const { usuario, creado } = await sembrarUsuario(definicion);
        resumen.push({
            email: usuario.email,
            documento: usuario.documento,
            roles: definicion.roles.join(', '),
            estado: creado ? 'creado' : 'ya existía'
        });
    }

    return resumen;
};

module.exports = { CONTRASENA, USUARIOS, sembrar };

// Ejecutable directo: `node src/database/seed.js`
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
