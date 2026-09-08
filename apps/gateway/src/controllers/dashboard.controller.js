/**
 * Dashboard. Vive en el gateway y no tiene tablas propias: agrega lo que ya
 * guardan Contratos, Inmuebles y Financiero (regla dura 5).
 *
 * Todas sus rutas exigen PROPIETARIO en `dashboard.routes.js`, así que aquí el
 * `sub` del token es siempre el del dueño.
 *
 * ESTE ES EL CONTROLADOR QUE MÁS CAMBIA al extraer Inmuebles, porque era el que
 * más JOIN anidados tenía: cada métrica bajaba de Pago a Contrato y de ahí a
 * Inmueble solo para llegar a `id_propietario`.
 *
 * Ahora ese dato se pide UNA VEZ por petición —la lista de inmuebles del
 * propietario— y de ella salen las dos cosas que hacían falta: los
 * identificadores con los que filtrar contratos y pagos, y el recuento por
 * estado, que antes eran dos `COUNT` contra la tabla de inmuebles.
 *
 * Pedirla una vez y no una por métrica no es microoptimización: `obtenerResumen`
 * calcula seis cosas, y una llamada de red por cada una convertiría el dashboard
 * en la pantalla más lenta de la aplicación.
 *
 * EN EL PASO 6c cambia de dónde salen las cifras de dinero. `Pago` es ahora
 * `CuentaCobro`, `monto_total` es `valor`, los estados son un catálogo y no
 * enteros, y —lo que más se nota aquí— `saldo_pendiente` ya no es una columna
 * que se pueda sumar en SQL: se deriva de las transacciones confirmadas. La
 * mora, que es la única métrica que lo necesita, lo pide a `conSaldos()`, que
 * resuelve la lista entera con una consulta agrupada.
 */
const { Sequelize } = require('sequelize');

const { dePropietario, ESTADO_ARRENDADO, ESTADO_DISPONIBLE } = require('../clientes/inmuebles');
const { adjuntarInmuebles } = require('../clientes/composicion');
const CuentaCobro = require('../models/CuentaCobro');
const Contrato = require('../models/Contrato');
const {
    ESTADO_CONTRATO_ACTIVO,
    ESTADO_CONTRATO_FINALIZADO,
    ESTADO_CUENTA_EN_MORA,
    ESTADO_CUENTA_PAGADA,
    ESTADO_CUENTA_PENDIENTE
} = require('../models/constantes');
const { hoyEnZonaNegocio } = require('../models/fechasContrato');
const { conSaldos } = require('../services/saldos');

/**
 * 502 con el formato de error del proyecto.
 *
 * Un fallo de ms-inmuebles NO se degrada a cifras en cero. Un dashboard que
 * dice «0 contratos activos, $0 de ingresos» cuando en realidad no pudo
 * preguntar es peor que un error: parece una respuesta.
 */
const responderServicioCaido = (res, error, accion) => {
    console.error(`Error al ${accion}:`, error.message);
    return res.status(502).json({ mensaje: 'No se pudo contactar el servicio de inmuebles' });
};

/** Contrato del propietario, como INNER JOIN sobre la lista de sus inmuebles. */
const contratoDe = (idsInmuebles, extra = {}) => ({
    model: Contrato,
    required: true,
    where: { id_inmueble: idsInmuebles },
    ...extra
});

// Obtener ingresos totales (suma de pagos realizados)
const obtenerIngresos = async (req, res) => {
    try {
        const { sub } = req.usuario;
        const mios = (await dePropietario(sub)).map((i) => i.id_inmueble);

        const resultado = await CuentaCobro.findAll({
            where: { estado: ESTADO_CUENTA_PAGADA },
            attributes: [
                [Sequelize.fn('SUM', Sequelize.col('valor')), 'total_ingresos'],
                [Sequelize.fn('COUNT', Sequelize.col('id_cuenta_cobro')), 'cantidad_pagos']
            ],
            include: [contratoDe(mios, { attributes: [] })],
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
        const mios = (await dePropietario(sub)).map((i) => i.id_inmueble);

        const enMora = await CuentaCobro.findAll({
            where: {
                [Sequelize.Op.or]: [
                    {
                        estado: ESTADO_CUENTA_PENDIENTE,
                        inicio: { [Sequelize.Op.lt]: hoy }
                    },
                    { estado: ESTADO_CUENTA_EN_MORA }
                ]
            },
            include: [contratoDe(mios)]
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
        const mios = (await dePropietario(sub)).map((i) => i.id_inmueble);

        const contratosActivos = await Contrato.findAll({
            where: { estado: ESTADO_CONTRATO_ACTIVO, id_inmueble: mios }
        });

        res.json({
            cantidad_activos: contratosActivos.length,
            // El detalle sí lleva el inmueble: la tarjeta lo muestra. Se compone
            // con los datos que ya se pidieron, sin un segundo viaje.
            contratos: await adjuntarInmuebles(contratosActivos)
        });
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener contratos activos');
    }
};

// Resumen general del Dashboard
const obtenerResumen = async (req, res) => {
    try {
        const { sub } = req.usuario;

        // UNA sola petición para las seis métricas.
        const inmuebles = await dePropietario(sub);
        const mios = inmuebles.map((i) => i.id_inmueble);

        const [ingresos, contratosActivos, contratosFinalizados, pagosPendientes] =
            await Promise.all([
                CuentaCobro.findAll({
                    where: { estado: ESTADO_CUENTA_PAGADA },
                    attributes: [[Sequelize.fn('SUM', Sequelize.col('valor')), 'total']],
                    include: [contratoDe(mios, { attributes: [] })],
                    raw: true
                }),
                Contrato.count({ where: { estado: ESTADO_CONTRATO_ACTIVO, id_inmueble: mios } }),
                Contrato.count({ where: { estado: ESTADO_CONTRATO_FINALIZADO, id_inmueble: mios } }),
                CuentaCobro.count({
                    where: { estado: ESTADO_CUENTA_PENDIENTE },
                    include: [contratoDe(mios)]
                })
            ]);

        // Los dos `COUNT` contra la tabla de inmuebles se convierten en contar
        // sobre lo que ya se trajo. Es una lista de decenas de filas, no de
        // millones: contarla en memoria cuesta menos que un viaje de red.
        const porEstado = (estado) => inmuebles.filter((i) => i.estado === estado).length;

        res.json({
            ingresos_totales: ingresos[0].total || 0,
            contratos: {
                activos: contratosActivos,
                finalizados: contratosFinalizados
            },
            inmuebles: {
                disponibles: porEstado(ESTADO_DISPONIBLE),
                arrendados: porEstado(ESTADO_ARRENDADO)
            },
            pagos_pendientes: pagosPendientes
        });
    } catch (error) {
        return responderServicioCaido(res, error, 'obtener resumen');
    }
};

module.exports = { obtenerIngresos, obtenerMora, obtenerContratosActivos, obtenerResumen };
