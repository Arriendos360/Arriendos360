const cron = require('node-cron');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { adjuntarPartes } = require('../clientes/composicion');
const { Contrato, Pago } = require('../models');
const { ESTADO_CONTRATO_ACTIVO } = require('../models/constantes');
const { diaDeCorte, fechaEnMes } = require('../models/fechasContrato');
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
 * Los correos van a personas, y las personas viven en ms-identidad; el inmueble
 * que se nombra en el aviso vive en ms-inmuebles. Antes los dos llegaban con un
 * `include` anidado; ahora `adjuntarPartes` los compone por HTTP en un solo lote
 * antes de recorrer la lista. Si alguno de los dos servicios no responde, esa
 * parte queda en `null` y el aviso se omite: el motor sigue generando cuentas de
 * cobro y marcando mora, que es su trabajo principal, y lo que se pierde es la
 * notificacion.
 *
 * Degradar aqui es lo correcto, al reves que en los controladores: este proceso
 * no autoriza a nadie, solo avisa. Un barrido que no manda un correo es un
 * incidente menor; un barrido que no genera las cuentas de cobro del mes porque
 * ms-inmuebles tosio, no.
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
        
        const contratos = await Contrato.findAll({ where: { estado: ESTADO_CONTRATO_ACTIVO } });

        // Un viaje a cada servicio para todos los contratos del barrido, no uno
        // por contrato.
        const contratosConPartes = await adjuntarPartes(contratos);

        for (const contrato of contratosConPartes) {
            // El día de corte sale de SU COLUMNA, no de recalcularlo desde el
            // inicio del contrato. Es la diferencia que trae el paso 6a: si
            // alguien renegocia el ciclo de facturación, el motor lo respeta.
            const diaCorte = diaDeCorte(contrato.fecha_inicio_corte);
            if (diaCorte === null) continue;

            // Determinar el mes y año de la "próxima factura"
            // Si hoy es 8 y el corte es 10, el mes es el actual.
            // Si hoy es 28 y el corte es 5, el mes es el siguiente.
            //
            // `fechaEnMes` y no `new Date(anio, mes, diaCorte)`: para un corte
            // el 31, febrero se desbordaba en silencio al 3 de marzo y el cobro
            // salía tres días tarde. Ahora se recorta al último día del mes.
            let fechaObjetivo = fechaEnMes(hoy.getFullYear(), hoy.getMonth(), diaCorte);
            
            // Si la fecha objetivo ya pasó hace mucho (más de 20 días), probablemente nos referimos al mes siguiente
            // Si hoy es 25 y el corte es 5, la fechaObjetivo (25, mes, 5) es del pasado.
            if (hoy.getDate() > diaCorte + 2) {
                // Mismo recorte al pasar de mes: `setMonth` tiene el mismo
                // desbordamiento que el constructor.
                fechaObjetivo = fechaEnMes(
                    fechaObjetivo.getFullYear(),
                    fechaObjetivo.getMonth() + 1,
                    diaCorte
                );
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
                        monto_total: contrato.canon,
                        saldo_pendiente: contrato.canon,
                        mes_correspondiente: fechaObjetivo,
                        estado: 1 // Pendiente
                    });

                    console.log(`✅ Recibo generado (Catch-up/Scheduled) para contrato ${contrato.id_contrato} - Periodo: ${mesSQL}/${anioSQL}`);

                    if (contrato.Inquilino) {
                        await enviarCorreo(
                            contrato.Inquilino.email,
                            '🏠 Nuevo recibo de arriendo generado',
                            `Hola ${contrato.Inquilino.nombres}, se ha generado tu recibo de arriendo para el periodo que inicia el ${diaCorte}. Valor: $${contrato.canon}.`
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
            include: [{ model: Contrato }]
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
