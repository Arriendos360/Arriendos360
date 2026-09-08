const cron = require('node-cron');
const { Op } = require('sequelize');

const { adjuntarPartes } = require('../clientes/composicion');
const { Contrato, CuentaCobro } = require('../models');
const {
    ESTADO_CONTRATO_ACTIVO,
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PENDIENTE
} = require('../models/constantes');
const {
    diaDeCorte,
    diasEntre,
    hoyEnZonaNegocio,
    mesSiguiente,
    partesDeISO,
    periodoDeCorte
} = require('../models/fechasContrato');
const { enviarCorreo } = require('../config/mailer');

/**
 * MOTOR FINANCIERO - Arriendos360
 *
 * Trazabilidad: la generacion de recibos es RF-11 y las alertas de mora son
 * RF-12. El control de dias de gracia no tiene requisito propio identificado;
 * queda marcado como pendiente de confirmar contra el SRS en vez de inventarle
 * un numero.
 *
 * Este proceso corre sin usuario autenticado, asi que las columnas de auditoria
 * quedan a nombre de USUARIO_SISTEMA (ver models/auditoria.js).
 *
 * Los correos van a personas, y las personas viven en ms-identidad; el inmueble
 * que se nombra en el aviso vive en ms-inmuebles. `adjuntarPartes` los compone
 * por HTTP en un solo lote antes de recorrer la lista. Si alguno de los dos
 * servicios no responde, esa parte queda en `null` y el aviso se omite: el motor
 * sigue generando cuentas de cobro y marcando mora, que es su trabajo principal,
 * y lo que se pierde es la notificacion.
 *
 * Degradar aqui es lo correcto, al reves que en los controladores: este proceso
 * no autoriza a nadie, solo avisa. Un barrido que no manda un correo es un
 * incidente menor; un barrido que no genera las cuentas de cobro del mes porque
 * ms-inmuebles tosio, no.
 *
 * ── LO QUE CAMBIA EN EL PASO 6c, Y LO QUE NO ─────────────────────────────────
 *
 * NO cambia el comportamiento: el recibo se sigue generando dos dias antes del
 * aniversario y la mora sigue entrando al sexto dia del corte. Tampoco hay
 * intereses ni recargos, y no los va a haber por esta via: RF-12 es alertas de
 * vencimiento, no cobro de mora.
 *
 * SI cambia con que se comparan las fechas. `mes_correspondiente`, que era un
 * instante `TIMESTAMPTZ`, es ahora un periodo de dos columnas `DATE`, y una
 * fecha de calendario no significa nada hasta que se dice en que zona se lee.
 * Antes el motor mezclaba las dos convenciones —columnas en UTC contra
 * `new Date()` local— y CLAUDE.md lo tenia anotado como pendiente. Ahora todo
 * pasa por `hoyEnZonaNegocio()` y `diasEntre()`, que cuentan dias de calendario
 * en `America/Bogota`: quien decide que un arriendo entro en mora al sexto dia
 * lo hace en Bogota, no en UTC ni en la zona en que este configurado el
 * contenedor.
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

/** El concepto que se imprime en la cuenta de cobro. */
const detalleDelPeriodo = (periodo) =>
    `Canon de arrendamiento del ${periodo.inicio} al ${periodo.fin}`;

/**
 * El periodo que le toca facturar hoy a un contrato con este día de corte.
 *
 * Reproduce exactamente la decisión que tomaba la versión anterior con
 * aritmética de `Date`, sólo que sobre componentes de calendario:
 *
 *   - se parte del corte de ESTE mes;
 *   - si hoy ya pasó de ese día por más de dos, el que toca es el del mes que
 *     viene (si hoy es 25 y el corte es 5, la próxima factura es la de junio,
 *     no la de mayo, que ya está).
 *
 * @param {number} diaCorte día pactado, 1-31
 * @param {string} hoy `YYYY-MM-DD` en la zona del negocio
 */
const periodoAFacturar = (diaCorte, hoy) => {
    const { anio, mes, dia } = partesDeISO(hoy);

    if (dia > diaCorte + 2) {
        const siguiente = mesSiguiente(anio, mes);
        return periodoDeCorte(diaCorte, siguiente.anio, siguiente.mes);
    }

    return periodoDeCorte(diaCorte, anio, mes);
};

/**
 * RF-11: Generación Automática de Recibos
 * Regla: 2 días antes de la fecha de corte (aniversario)
 *
 * La cuenta de cobro nace con el PERIODO EXPLÍCITO, no con un mes suelto. La
 * regla que lo define está en `models/fechasContrato.js` y se resume en que
 * `fin` es el día anterior al siguiente corte, de modo que los periodos teselan
 * el calendario sin huecos ni solapes.
 */
const procesarContratos = async () => {
    try {
        const hoy = hoyEnZonaNegocio();

        const contratos = await Contrato.findAll({ where: { estado: ESTADO_CONTRATO_ACTIVO } });

        // Un viaje a cada servicio para todos los contratos del barrido, no uno
        // por contrato.
        const contratosConPartes = await adjuntarPartes(contratos);

        for (const contrato of contratosConPartes) {
            // El día de corte sale de SU COLUMNA, no de recalcularlo desde el
            // inicio del contrato. Es la diferencia que trajo el paso 6a: si
            // alguien renegocia el ciclo de facturación, el motor lo respeta.
            const diaCorte = diaDeCorte(contrato.fecha_inicio_corte);
            if (diaCorte === null) continue;

            const periodo = periodoAFacturar(diaCorte, hoy);

            // ¿Estamos dentro de la ventana de 2 días antes del corte? ¿O el
            // corte ya llegó y no se ha cobrado?
            if (diasEntre(hoy, periodo.inicio) > 2) continue;

            // La comprobación es ahora una igualdad sobre `inicio` en vez de un
            // `date_part` sobre el mes: identifica el periodo exacto y además
            // puede usar el índice único que lo respalda.
            const yaExiste = await CuentaCobro.findOne({
                where: { id_contrato: contrato.id_contrato, inicio: periodo.inicio }
            });

            if (yaExiste) continue;

            await CuentaCobro.create({
                id_contrato: contrato.id_contrato,
                detalle: detalleDelPeriodo(periodo),
                valor: contrato.canon,
                inicio: periodo.inicio,
                fin: periodo.fin,
                estado: ESTADO_CUENTA_PENDIENTE
            });

            console.log(
                `✅ Cuenta de cobro generada para contrato ${contrato.id_contrato}` +
                ` — periodo ${periodo.inicio} a ${periodo.fin}`
            );

            if (contrato.Inquilino) {
                await enviarCorreo(
                    contrato.Inquilino.email,
                    '🏠 Nuevo recibo de arriendo generado',
                    `Hola ${contrato.Inquilino.nombres}, se ha generado tu recibo de arriendo para el periodo que inicia el ${diaCorte}. Valor: $${contrato.canon}.`
                );
            }
        }
    } catch (error) {
        console.error('❌ Error en procesarContratos:', error);
    }
};

/**
 * Control de Días de Gracia (requisito por confirmar en el SRS)
 * RF-12: Alertas de Vencimiento y Vencido
 *
 * Barre las cuentas PENDIENTE y EN_MORA, igual que antes barría los estados 1 y
 * 3. `PARCIAL` sigue quedando fuera, que es lo que hacía: una cuenta con algo
 * abonado no se marca en mora por este camino.
 *
 * Los días se cuentan desde `inicio`, que es la fecha de corte y es exactamente
 * lo que guardaba `mes_correspondiente`. No hay cálculo de intereses ni de
 * recargos: RF-12 pide avisar, no cobrar.
 */
const procesarPagos = async () => {
    try {
        const hoy = hoyEnZonaNegocio();

        const cuentasPendientes = await CuentaCobro.findAll({
            where: { estado: { [Op.in]: [ESTADO_CUENTA_PENDIENTE, ESTADO_CUENTA_EN_MORA] } },
            include: [{ model: Contrato }]
        });

        // Igual que arriba: se componen las partes de todos los contratos
        // implicados de una vez, no uno por uno dentro del bucle.
        const contratosConPartes = await adjuntarPartes(
            cuentasPendientes.map((cuenta) => cuenta.Contrato).filter(Boolean)
        );
        const porContrato = new Map(contratosConPartes.map((c) => [c.id_contrato, c]));

        for (const cuenta of cuentasPendientes) {
            const contratoCompuesto = porContrato.get(cuenta.id_contrato);
            if (!contratoCompuesto) continue;

            const diasDesdeCorte = diasEntre(cuenta.inicio, hoy);

            // RF-12: Vencimiento Próximo (1 día antes de que expire el tiempo de gracia)
            if (diasDesdeCorte === 4 && cuenta.estado === ESTADO_CUENTA_PENDIENTE) {
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
            if (diasDesdeCorte >= 6 && cuenta.estado === ESTADO_CUENTA_PENDIENTE) {
                await cuenta.update({ estado: ESTADO_CUENTA_EN_MORA });
                console.log(`🚫 Cuenta de cobro ${cuenta.id_cuenta_cobro} marcada como EN MORA`);

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

module.exports = {
    detalleDelPeriodo,
    iniciarMotorFinanciero,
    periodoAFacturar,
    procesarContratos,
    procesarPagos
};
