/**
 * Dashboard del propietario. Compone respuestas de ms-contratos, ms-inmuebles y
 * ms-financiero, sin tablas propias. Si un servicio falla responde 502, nunca
 * ceros.
 */

const { contratosDePropietario } = require('../clientes/contratos');
const { cuentasDeContratos } = require('../clientes/financiero');
const { dePropietario, ESTADO_ARRENDADO, ESTADO_DISPONIBLE } = require('../clientes/inmuebles');
const { adjuntarInmuebles } = require('../clientes/composicion');
const {
    ESTADO_CONTRATO_ACTIVO,
    ESTADO_CONTRATO_FINALIZADO,
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PAGADA,
    ESTADO_CUENTA_PARCIAL,
    ESTADO_CUENTA_PENDIENTE
} = require('../constantes');
const { hoyEnZonaNegocio } = require('arriendos360-shared');

/** 502 que nombra el servicio que falló. */
const responderServicioCaido = (res, error, accion) => {
    console.error(`Error al ${accion}:`, error.message);

    const mensaje = String(error.message);
    const servicio = mensaje.includes('ms-financiero')
        ? 'financiero'
        : mensaje.includes('ms-contratos')
          ? 'contratos'
          : 'inmuebles';

    return res.status(502).json({ mensaje: `No se pudo contactar el servicio de ${servicio}` });
};

/** Los identificadores de los contratos del propietario. Una petición. */
const idsDeContratos = async (sub) =>
    (await contratosDePropietario(sub)).map((contrato) => contrato.id_contrato);

/** Suma un campo numérico de una lista de cuentas de cobro. */
const sumar = (cuentas, campo) =>
    cuentas.reduce((total, cuenta) => total + parseFloat(cuenta[campo] || 0), 0);

// Obtener ingresos totales (suma de cuentas de cobro pagadas)
const obtenerIngresos = async (req, res) => {
    try {
        const { sub } = req.usuario;
        const mios = await idsDeContratos(sub);

        const pagadas = await cuentasDeContratos(mios, [ESTADO_CUENTA_PAGADA]);

        res.json({
            total_ingresos: sumar(pagadas, 'valor'),
            cantidad_pagos: pagadas.length
        });
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener ingresos');
    }
};

// Obtener cuentas de cobro en mora (vencidas o pendientes con corte pasado)
const obtenerMora = async (req, res) => {
    try {
        const { sub } = req.usuario;
        const hoy = hoyEnZonaNegocio();
        const mios = await idsDeContratos(sub);

        // EN_MORA entran todas; PENDIENTE y PARCIAL, sólo si su corte ya pasó.
        const candidatas = await cuentasDeContratos(mios, [
            ESTADO_CUENTA_PENDIENTE,
            ESTADO_CUENTA_PARCIAL,
            ESTADO_CUENTA_EN_MORA
        ]);

        const enMora = candidatas.filter(
            (cuenta) => cuenta.estado === ESTADO_CUENTA_EN_MORA || cuenta.inicio < hoy
        );

        const totalMora = enMora.reduce((suma, cuenta) => {
            const pendiente = parseFloat(cuenta.saldo_pendiente);
            return suma + (pendiente > 0 ? pendiente : parseFloat(cuenta.valor));
        }, 0);

        res.json({
            cantidad_en_mora: enMora.length,
            total_mora: totalMora,
            detalle: enMora
        });
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener mora');
    }
};

// Obtener contratos activos
const obtenerContratosActivos = async (req, res) => {
    try {
        const { sub } = req.usuario;

        const contratos = await contratosDePropietario(sub);
        const activos = contratos.filter((c) => c.estado === ESTADO_CONTRATO_ACTIVO);

        res.json({
            cantidad_activos: activos.length,
            contratos: await adjuntarInmuebles(activos)
        });
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener contratos activos');
    }
};

// Resumen general del Dashboard
const obtenerResumen = async (req, res) => {
    try {
        const { sub } = req.usuario;

        // Inmuebles y contratos en paralelo; las cuentas dependen de los contratos.
        const [inmuebles, contratos] = await Promise.all([
            dePropietario(sub),
            contratosDePropietario(sub)
        ]);

        const idsContratos = contratos.map((c) => c.id_contrato);

        const cuentas = await cuentasDeContratos(idsContratos, [
            ESTADO_CUENTA_PAGADA,
            ESTADO_CUENTA_PENDIENTE
        ]);

        const deEstado = (estado) => cuentas.filter((c) => c.estado === estado);

        const inmueblesPorEstado = (estado) => inmuebles.filter((i) => i.estado === estado).length;
        const contratosPorEstado = (estado) => contratos.filter((c) => c.estado === estado).length;

        res.json({
            ingresos_totales: sumar(deEstado(ESTADO_CUENTA_PAGADA), 'valor'),
            contratos: {
                activos: contratosPorEstado(ESTADO_CONTRATO_ACTIVO),
                finalizados: contratosPorEstado(ESTADO_CONTRATO_FINALIZADO)
            },
            inmuebles: {
                disponibles: inmueblesPorEstado(ESTADO_DISPONIBLE),
                arrendados: inmueblesPorEstado(ESTADO_ARRENDADO)
            },
            pagos_pendientes: deEstado(ESTADO_CUENTA_PENDIENTE).length
        });
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener resumen');
    }
};

module.exports = { obtenerIngresos, obtenerMora, obtenerContratosActivos, obtenerResumen };
