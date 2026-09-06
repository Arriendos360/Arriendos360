const cron = require('node-cron');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Contrato, Inmueble, Pago, Inquilino, Propietario, Usuario } = require('../models');
const { enviarCorreo } = require('../config/mailer');

/**
 * MOTOR FINANCIERO - Arriendos360
 * RF-14, RF-15, RF-16
 */

const iniciarMotorFinanciero = () => {
    // Ejecutar cada día a la medianoche (00:01)
    cron.schedule('1 0 * * *', async () => {
        console.log('⏳ Iniciando proceso diario del Motor Financiero...');
        await procesarContratos();
        await procesarPagos();
    });
    console.log('🚀 Motor Financiero programado (Ejecución diaria)');
};

/**
 * RF-14: Generación Automática de Recibos
 * Regla: 2 días antes de la fecha de corte (aniversario)
 */
const procesarContratos = async () => {
    try {
        const hoy = new Date();
        // Definimos el rango: hoy y mañana (para detectar cobros que deberían generarse en los próximos 2 días)
        // O incluso mejor: cualquier aniversario pendiente que sea <= hoy + 2 días.
        
        const fechaLimite = new Date();
        fechaLimite.setDate(hoy.getDate() + 2);
        
        const contratos = await Contrato.findAll({
            where: { estado: 1 },
            include: [
                { model: Inmueble, include: [{ model: Propietario, include: [Usuario] }] },
                { model: Inquilino, include: [Usuario] }
            ]
        });

        for (const contrato of contratos) {
            const fechaInicio = new Date(contrato.fecha_inicio);
            const diaCorte = fechaInicio.getDate();
            
            // Determinar el mes y año de la "próxima factura"
            // Si hoy es 8 y el corte es 10, el mes es el actual.
            // Si hoy es 28 y el corte es 5, el mes es el siguiente.
            let fechaObjetivo = new Date(hoy.getFullYear(), hoy.getMonth(), diaCorte);
            
            // Si la fecha objetivo ya pasó hace mucho (más de 20 días), probablemente nos referimos al mes siguiente
            // Si hoy es 25 y el corte es 5, la fechaObjetivo (25, mes, 5) es del pasado.
            if (hoy.getDate() > diaCorte + 2) {
                fechaObjetivo.setMonth(fechaObjetivo.getMonth() + 1);
            }

            // ¿Estamos dentro de la ventana de 2 días antes de la fecha objetivo?
            // O ¿la fecha objetivo ya llegó/pasó y no se ha cobrado?
            const diffDias = Math.ceil((fechaObjetivo - hoy) / (1000 * 60 * 60 * 24));

            if (diffDias <= 2) {
                const mesSQL = fechaObjetivo.getMonth() + 1;
                const anioSQL = fechaObjetivo.getFullYear();

                const yaExiste = await Pago.findOne({
                    where: {
                        id_contrato: contrato.id_contrato,
                        [Op.and]: [
                            sequelize.where(sequelize.fn('date_part', 'month', sequelize.col('mes_correspondiente')), mesSQL),
                            sequelize.where(sequelize.fn('date_part', 'year', sequelize.col('mes_correspondiente')), anioSQL)
                        ]
                    }
                });

                if (!yaExiste) {
                    await Pago.create({
                        id_contrato: contrato.id_contrato,
                        monto_total: contrato.valor_mensual,
                        saldo_pendiente: contrato.valor_mensual,
                        mes_correspondiente: fechaObjetivo,
                        estado: 1 // Pendiente
                    });

                    console.log(`✅ Recibo generado (Catch-up/Scheduled) para contrato ${contrato.id_contrato} - Periodo: ${mesSQL}/${anioSQL}`);

                    if (contrato.Inquilino && contrato.Inquilino.Usuario) {
                        await enviarCorreo(
                            contrato.Inquilino.Usuario.correo,
                            '🏠 Nuevo recibo de arriendo generado',
                            `Hola ${contrato.Inquilino.Usuario.nombres}, se ha generado tu recibo de arriendo para el periodo que inicia el ${diaCorte}. Valor: $${contrato.valor_mensual}.`
                        );
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error en procesarContratos:', error);
    }
};

/**
 * RF-16: Control de Días de Gracia y Cálculo de Mora
 * RF-15: Alertas de Vencimiento y Vencido
 */
const procesarPagos = async () => {
    try {
        const hoy = new Date();
        
        const pagosPendientes = await Pago.findAll({
            where: { estado: { [Op.in]: [1, 3] } }, // Pendiente o En Mora
            include: [
                { 
                    model: Contrato, 
                    include: [
                        { model: Inmueble, include: [{ model: Propietario, include: [Usuario] }] },
                        { model: Inquilino, include: [Usuario] }
                    ] 
                }
            ]
        });

        for (const pago of pagosPendientes) {
            if (!pago.Contrato) continue;
            
            const fechaCorte = new Date(pago.mes_correspondiente);
            const diffTiempo = hoy - fechaCorte;
            const diffDias = Math.floor(diffTiempo / (1000 * 60 * 60 * 24));

            // RF-15: Vencimiento Próximo (1 día antes de que expire el tiempo de gracia)
            if (diffDias === 4 && pago.estado === 1) {
                if (pago.Contrato.Inquilino) {
                    await enviarCorreo(
                        pago.Contrato.Inquilino.Usuario.correo,
                        '⚠️ Aviso: Tu pago vence pronto',
                        `Recuerda que tienes hasta mañana para realizar el pago de tu arriendo sin generar mora.`
                    );
                }
                if (pago.Contrato.Inmueble && pago.Contrato.Inmueble.Propietario) {
                    await enviarCorreo(
                        pago.Contrato.Inmueble.Propietario.Usuario.correo,
                        '📢 Recordatorio de pago próximo a vencer',
                        `El pago del inmueble ${pago.Contrato.Inmueble.direccion} vence mañana.`
                    );
                }
            }

            // RF-16: Cambio a Mora (Al inicio del sexto día)
            if (diffDias >= 6 && pago.estado === 1) {
                await pago.update({ estado: 3 }); // 3 = Vencido/En Mora
                console.log(`🚫 Pago ${pago.id_pago} marcado como EN MORA`);

                // RF-15: Vencido (Al inquilino y propietario)
                if (pago.Contrato.Inquilino) {
                    await enviarCorreo(
                        pago.Contrato.Inquilino.Usuario.correo,
                        '🚨 Pago Vencido - Mora Generada',
                        `Tu pago de arriendo ha superado el periodo de gracia. Por favor regulariza tu situación.`
                    );
                }
                if (pago.Contrato.Inmueble && pago.Contrato.Inmueble.Propietario) {
                    await enviarCorreo(
                        pago.Contrato.Inmueble.Propietario.Usuario.correo,
                        '🔴 Notificación de Inquilino en Mora',
                        `El inquilino del inmueble ${pago.Contrato.Inmueble.direccion} ha entrado en mora.`
                    );
                }
            }
        }
    } catch (error) {
        console.error('❌ Error en procesarPagos:', error);
    }
};

module.exports = { iniciarMotorFinanciero, procesarContratos, procesarPagos };
