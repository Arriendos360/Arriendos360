/**
 * Dashboard. Vive en el gateway y no tiene tablas propias: agrega lo que ya
 * guardan Contratos, Inmuebles y Financiero (regla dura 5).
 *
 * Todas sus rutas exigen PROPIETARIO en `dashboard.routes.js`, así que aquí el
 * `sub` del token es siempre el del dueño.
 *
 * ── ES EL CONTROLADOR QUE MÁS CAMBIA EN CADA EXTRACCIÓN ─────────────────────
 *
 * Y no por casualidad: es el único que toca los tres contextos a la vez, así que
 * cada servicio que sale le quita un `include`. El paso 4 le quitó el de
 * Inmuebles; el 6d le quita el de Contratos, que era el que quedaba.
 *
 * Lo que sostiene el diseño después de los dos es la misma regla: **cada dato
 * externo se pide UNA VEZ por petición, no una por métrica.** `obtenerResumen`
 * calcula seis cosas, y una llamada de red por cada una convertiría el dashboard
 * en la pantalla más lenta de la aplicación. Ahora son dos llamadas —los
 * inmuebles del propietario y sus contratos— y de ellas salen las seis.
 *
 * ── UN FALLO NO SE DEGRADA A CEROS ──────────────────────────────────────────
 *
 * Vale para los dos servicios. Un dashboard que dice «0 contratos activos, $0 de
 * ingresos» cuando en realidad no pudo preguntar es peor que un error: parece
 * una respuesta. Por eso las dos llamadas propagan y aquí se traducen en 502.
 */
const { Sequelize } = require('sequelize');

const { contratosDePropietario } = require('../clientes/contratos');
const { dePropietario, ESTADO_ARRENDADO, ESTADO_DISPONIBLE } = require('../clientes/inmuebles');
const { adjuntarInmuebles } = require('../clientes/composicion');
const CuentaCobro = require('../models/CuentaCobro');
const {
    ESTADO_CONTRATO_ACTIVO,
    ESTADO_CONTRATO_FINALIZADO,
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PAGADA,
    ESTADO_CUENTA_PENDIENTE
} = require('../models/constantes');
const { hoyEnZonaNegocio } = require('arriendos360-shared');
const { conSaldos } = require('../services/saldos');

/**
 * 502 con el formato de error del proyecto.
 *
 * El mensaje nombra el servicio que falló, porque ya son dos y saber cuál
 * ahorra el rato de mirar los dos logs.
 */
const responderServicioCaido = (res, error, accion) => {
    console.error(`Error al ${accion}:`, error.message);
    const servicio = String(error.message).includes('ms-contratos') ? 'contratos' : 'inmuebles';
    return res.status(502).json({ mensaje: `No se pudo contactar el servicio de ${servicio}` });
};

/** Los identificadores de los contratos del propietario. Una petición. */
const idsDeContratos = async (sub) =>
    (await contratosDePropietario(sub)).map((contrato) => contrato.id_contrato);

/** Filtro sobre las cuentas de cobro de esos contratos. */
const deSusContratos = (idsContratos) => ({ id_contrato: idsContratos });

// Obtener ingresos totales (suma de cuentas de cobro pagadas)
const obtenerIngresos = async (req, res) => {
    try {
        const { sub } = req.usuario;
        const mios = await idsDeContratos(sub);

        const resultado = await CuentaCobro.findAll({
            where: { estado: ESTADO_CUENTA_PAGADA, ...deSusContratos(mios) },
            attributes: [
                [Sequelize.fn('SUM', Sequelize.col('valor')), 'total_ingresos'],
                [Sequelize.fn('COUNT', Sequelize.col('id_cuenta_cobro')), 'cantidad_pagos']
            ],
            raw: true
        });

        res.json({
            total_ingresos: resultado[0].total_ingresos || 0,
            cantidad_pagos: resultado[0].cantidad_pagos || 0
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

        const enMora = await CuentaCobro.findAll({
            where: {
                ...deSusContratos(mios),
                [Sequelize.Op.or]: [
                    {
                        estado: ESTADO_CUENTA_PENDIENTE,
                        inicio: { [Sequelize.Op.lt]: hoy }
                    },
                    { estado: ESTADO_CUENTA_EN_MORA }
                ]
            }
        });

        // El saldo se deriva para toda la lista de una vez, y el detalle sale de
        // aquí ya con el campo `saldo_pendiente` que la pantalla espera.
        const conSaldo = await conSaldos(enMora);

        const totalMora = conSaldo.reduce((sum, cuenta) => {
            const pendiente = cuenta.saldo_pendiente;
            return sum + (pendiente > 0 ? pendiente : parseFloat(cuenta.valor));
        }, 0);

        res.json({
            cantidad_en_mora: conSaldo.length,
            total_mora: totalMora,
            detalle: conSaldo
        });
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener mora');
    }
};

// Obtener contratos activos
const obtenerContratosActivos = async (req, res) => {
    try {
        const { sub } = req.usuario;

        // Ya no hay `Contrato.findAll`: la lista viene de ms-contratos, que
        // aplica el filtro de pertenencia y devuelve sólo los de sus inmuebles.
        const contratos = await contratosDePropietario(sub);
        const activos = contratos.filter((c) => c.estado === ESTADO_CONTRATO_ACTIVO);

        res.json({
            cantidad_activos: activos.length,
            // El detalle sí lleva el inmueble: la tarjeta lo muestra. Un lote
            // para toda la lista, no uno por contrato.
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

        // DOS peticiones para las seis métricas, y en paralelo porque no
        // dependen entre sí: los inmuebles del propietario y sus contratos.
        const [inmuebles, contratos] = await Promise.all([
            dePropietario(sub),
            contratosDePropietario(sub)
        ]);

        const idsContratos = contratos.map((c) => c.id_contrato);

        const [ingresos, pagosPendientes] = await Promise.all([
            CuentaCobro.findAll({
                where: { estado: ESTADO_CUENTA_PAGADA, ...deSusContratos(idsContratos) },
                attributes: [[Sequelize.fn('SUM', Sequelize.col('valor')), 'total']],
                raw: true
            }),
            CuentaCobro.count({
                where: { estado: ESTADO_CUENTA_PENDIENTE, ...deSusContratos(idsContratos) }
            })
        ]);

        // Los dos `COUNT` contra la tabla de contratos y los dos contra la de
        // inmuebles se convierten en contar sobre lo que ya se trajo. Son listas
        // de decenas de filas, no de millones: contarlas en memoria cuesta menos
        // que cuatro viajes de red.
        const inmueblesPorEstado = (estado) => inmuebles.filter((i) => i.estado === estado).length;
        const contratosPorEstado = (estado) => contratos.filter((c) => c.estado === estado).length;

        res.json({
            ingresos_totales: ingresos[0].total || 0,
            contratos: {
                activos: contratosPorEstado(ESTADO_CONTRATO_ACTIVO),
                finalizados: contratosPorEstado(ESTADO_CONTRATO_FINALIZADO)
            },
            inmuebles: {
                disponibles: inmueblesPorEstado(ESTADO_DISPONIBLE),
                arrendados: inmueblesPorEstado(ESTADO_ARRENDADO)
            },
            pagos_pendientes: pagosPendientes
        });
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener resumen');
    }
};

module.exports = { obtenerIngresos, obtenerMora, obtenerContratosActivos, obtenerResumen };
