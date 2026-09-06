const { procesarContratos, procesarPagos } = require('../src/services/financialEngine');
const { Contrato, Inmueble, Pago, Inquilino, Propietario, Usuario } = require('../src/models');
const { sequelize } = require('../src/config/database');

beforeAll(async () => {
    await sequelize.sync({ force: true });
});

afterAll(async () => {
    await sequelize.close();
});

describe('Motor Financiero (Automatización)', () => {
    let idContrato;

    jest.setTimeout(15000); // Aumentar timeout para procesos de motor

    test('RF-14: Debería generar un recibo si faltan 2 días para el aniversario', async () => {
        // ... (rest remains same but I'll replace everything for safety)
        // 1. Crear Usuario e Inquilino
        const user = await Usuario.create({
            correo: 'inq_finance@test.com', hash_contrasena: 'hashed', rol: 'inquilino', nombres: 'I', apellidos: 'F'
        });
        await Inquilino.create({ id_inquilino: 'FIN1', id_usuario: user.id_usuario });

        // 2. Crear Propietario e Inmueble
        const owner = await Usuario.create({
            correo: 'prop_finance@test.com', hash_contrasena: 'hashed', rol: 'propietario', nombres: 'P', apellidos: 'F'
        });
        await Propietario.create({ id_propietario: 'PROP1', id_usuario: owner.id_usuario });
        const inm = await Inmueble.create({ direccion: 'Finance Street', id_propietario: 'PROP1' });

        // 3. Crear Contrato que inició un día como "pasado mañana"
        const pasadoManana = new Date();
        pasadoManana.setDate(pasadoManana.getDate() + 2);
        
        const contrato = await Contrato.create({
            id_inmueble: inm.id_inmueble,
            id_inquilino: 'FIN1',
            fecha_inicio: pasadoManana,
            fecha_fin: new Date(2025, 1, 1),
            valor_mensual: 1000,
            estado: 1 // Activo
        });
        idContrato = contrato.id_contrato;

        // 4. Ejecutar motor manualmente
        await procesarContratos();

        // 5. Verificar si se creó el pago
        const pago = await Pago.findOne({ where: { id_contrato: idContrato } });
        expect(pago).toBeDefined();
        expect(pago.estado).toBe(1); // Pendiente
        expect(parseFloat(pago.monto_total)).toBe(1000);
    });

    test('RF-16: Debería cambiar a MORA después de 6 días del corte', async () => {
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
