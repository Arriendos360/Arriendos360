const crypto = require('crypto');

const { procesarContratos, procesarPagos } = require('../src/services/financialEngine');
const { Contrato, Inmueble, Pago, RolUsuario, Usuario } = require('../src/models');
const { ROLES, USUARIO_SISTEMA } = require('../src/models/constantes');
const { cerrarBase, recrearBase } = require('./utiles/entorno');

/**
 * Estas pruebas construyen los datos con los modelos en vez de con la API,
 * porque el motor financiero no tiene endpoint propio salvo el de disparo
 * manual. La creación de usuarios pasó de tres tablas (`usuarios` +
 * `propietarios` / `inquilinos`) a dos (`usuarios` + `roles_usuario`), así que
 * el arranque es más corto que antes.
 */
const crearUsuario = async ({ email, nombres, apellidos, documento, rol }) => {
    const id = crypto.randomUUID();

    const usuario = await Usuario.create(
        {
            id_usuario: id,
            email,
            contrasena: 'hashed',
            nombres,
            apellidos,
            documento,
            creado_por: USUARIO_SISTEMA
        },
        { usuarioAuditor: USUARIO_SISTEMA }
    );

    await RolUsuario.create(
        { id_rol: ROLES[rol], id_usuario: id, creado_por: USUARIO_SISTEMA },
        { usuarioAuditor: USUARIO_SISTEMA }
    );

    return usuario;
};

beforeAll(async () => {
    await recrearBase();
});

afterAll(async () => {
    await cerrarBase();
});

describe('Motor Financiero (Automatización)', () => {
    let idContrato;

    jest.setTimeout(15000); // Aumentar timeout para procesos de motor

    test('RF-11: Debería generar un recibo si faltan 2 días para el aniversario', async () => {
        // 1. Inquilino
        const inquilino = await crearUsuario({
            email: 'inq_finance@test.com', nombres: 'I', apellidos: 'F', documento: 'FIN1', rol: 'INQUILINO'
        });

        // 2. Propietario e inmueble. `id_propietario` guarda el UUID del usuario,
        //    no su cédula.
        const propietario = await crearUsuario({
            email: 'prop_finance@test.com', nombres: 'P', apellidos: 'F', documento: 'PROP1', rol: 'PROPIETARIO'
        });
        const inm = await Inmueble.create(
            { direccion: 'Finance Street', id_propietario: propietario.id_usuario },
            { usuarioAuditor: propietario.id_usuario }
        );

        // 3. Crear Contrato que inició un día como "pasado mañana"
        const pasadoManana = new Date();
        pasadoManana.setDate(pasadoManana.getDate() + 2);

        const contrato = await Contrato.create(
            {
                id_inmueble: inm.id_inmueble,
                id_inquilino: inquilino.id_usuario,
                fecha_inicio: pasadoManana,
                fecha_fin: new Date(2025, 1, 1),
                valor_mensual: 1000,
                estado: 1 // Activo
            },
            { usuarioAuditor: propietario.id_usuario }
        );
        idContrato = contrato.id_contrato;

        // 4. Ejecutar motor manualmente
        await procesarContratos();

        // 5. Verificar si se creó el pago
        const pago = await Pago.findOne({ where: { id_contrato: idContrato } });
        expect(pago).not.toBeNull();
        expect(pago.estado).toBe(1); // Pendiente
        expect(parseFloat(pago.monto_total)).toBe(1000);

        // El motor corre sin usuario autenticado, así que la auditoría queda a
        // nombre del usuario de sistema.
        expect(pago.creado_por).toBe(USUARIO_SISTEMA);
    });

    test('Debería cambiar a MORA después de 6 días del corte', async () => {
        // 1. Crear un pago pendiente de hace 7 días para el contrato existente
        const hoy = new Date();
        const haceSieteDias = new Date(hoy.getTime() - (7 * 24 * 60 * 60 * 1000));

        const pagoAntiguo = await Pago.create({
            id_contrato: idContrato,
            monto_total: 1000,
            saldo_pendiente: 1000,
            mes_correspondiente: haceSieteDias,
            estado: 1 // Pendiente
        });

        // 2. Ejecutar motor manualmente
        await procesarPagos();

        // 3. Verificar cambio de estado
        const pagoActualizado = await Pago.findByPk(pagoAntiguo.id_pago);
        expect(pagoActualizado.estado).toBe(3); // En Mora
    });
});
