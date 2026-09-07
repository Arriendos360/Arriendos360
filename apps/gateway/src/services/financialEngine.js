const cron = require('node-cron');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { adjuntarPartes } = require('../clientes/composicion');
const { Contrato, Inmueble, Pago } = require('../models');
const { enviarCorreo } = require('../config/mailer');

/**
 * MOTOR FINANCIERO - Arriendos360
 *
 * Trazabilidad corregida: los comentarios citaban RF-14, RF-15 y RF-16, pero
 * segun el SRS esos son requisitos del Dashboard. La generacion de recibos es
 * RF-11 y las alertas de mora son RF-12. El control de dias de gracia no tiene
 * requisito propio identificado; queda marcado como pendiente de confirmar
 * contra el SRS en vez de inventarle un numero.
 *
 * Este proceso corre sin usuario autenticado, asi que las columnas de auditoria
 * quedan a nombre de USUARIO_SISTEMA (ver models/auditoria.js).
 *
 * Los correos van a personas, y las personas viven en ms-identidad. Antes sus
 * datos llegaban con un `include`; ahora se componen por HTTP en un solo lote
 * antes de recorrer la lista. Si el servicio no responde, las partes quedan en
 * `null` y el aviso se omite: el motor sigue generando cuentas de cobro y
 * marcando mora, que es su trabajo principal, y lo que se pierde es la
 * notificacion.
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
 * RF-11: Generación Automática de Recibos
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
            include: [{ model: Inmueble }]
        });

        // Un solo viaje a ms-identidad para todos los contratos del barrido.
        const contratosConPartes = await adjuntarPartes(contratos);

        for (const contrato of contratosConPartes) {
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

                    if (contrato.Inquilino) {
                        await enviarCorreo(
                            contrato.Inquilino.email,
                            '🏠 Nuevo recibo de arriendo generado',
                            `Hola ${contrato.Inquilino.nombres}, se ha generado tu recibo de arriendo para el periodo que inicia el ${diaCorte}. Valor: $${contrato.valor_mensual}.`
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
 * Control de Días de Gracia y Cálculo de Mora (requisito por confirmar en el SRS)
 * RF-12: Alertas de Vencimiento y Vencido
 */
const procesarPagos = async () => {
    try {
        const hoy = new Date();
        
        const pagosPendientes = await Pago.findAll({
            where: { estado: { [Op.in]: [1, 3] } }, // Pendiente o En Mora
            include: [
                { 
                    model: Contrato, 
                    include: [{ model: Inmueble }]
                }
            ]
        });

        // Igual que arriba: se componen las partes de todos los contratos
        // implicados de una vez, no uno por uno dentro del bucle.
        const contratosConPartes = await adjuntarPartes(
            pagosPendientes.map((pago) => pago.Contrato).filter(Boolean)
        );
        const porContrato = new Map(contratosConPartes.map((c) => [c.id_contrato, c]));

        for (const pagoOriginal of pagosPendientes) {
            const pago = pagoOriginal;
            const contratoCompuesto = porContrato.get(pago.id_contrato);
            if (!contratoCompuesto) continue;
            
            const fechaCorte = new Date(pago.mes_correspondiente);
            const diffTiempo = hoy - fechaCorte;
            const diffDias = Math.floor(diffTiempo / (1000 * 60 * 60 * 24));

            // RF-12: Vencimiento Próximo (1 día antes de que expire el tiempo de gracia)
            if (diffDias === 4 && pago.estado === 1) {
                if (contratoCompuesto.Inquilino) {
                    await enviarCorreo(
                        contratoCompuesto.Inquilino.email,
                        '⚠️ Aviso: Tu pago vence pronto',
                        `Recuerda que tienes hasta mañana para realizar el pago de tu arriendo sin generar mora.`
                    );
                }
                if (contratoCompuesto.Inmueble && contratoCompuesto.Inmueble.Propietario) {
                    await enviarCorreo(
                        contratoCompuesto.Inmueble.Propietario.email,
                        '📢 Recordatorio de pago próximo a vencer',
                        `El pago del inmueble ${contratoCompuesto.Inmueble.direccion} vence mañana.`
                    );
                }
            }

            // Cambio a Mora (Al inicio del sexto día)
            if (diffDias >= 6 && pago.estado === 1) {
                await pago.update({ estado: 3 }); // 3 = Vencido/En Mora
                console.log(`🚫 Pago ${pago.id_pago} marcado como EN MORA`);

                // RF-12: Vencido (Al inquilino y propietario)
                if (contratoCompuesto.Inquilino) {
                    await enviarCorreo(
                        contratoCompuesto.Inquilino.email,
                        '🚨 Pago Vencido - Mora Generada',
                        `Tu pago de arriendo ha superado el periodo de gracia. Por favor regulariza tu situación.`
                    );
                }
                if (contratoCompuesto.Inmueble && contratoCompuesto.Inmueble.Propietario) {
                    await enviarCorreo(
                        contratoCompuesto.Inmueble.Propietario.email,
                        '🔴 Notificación de Inquilino en Mora',
                        `El inquilino del inmueble ${contratoCompuesto.Inmueble.direccion} ha entrado en mora.`
                    );
                }
            }
        }
    } catch (error) {
        console.error('❌ Error en procesarPagos:', error);
    }
};

module.exports = { iniciarMotorFinanciero, procesarContratos, procesarPagos };
