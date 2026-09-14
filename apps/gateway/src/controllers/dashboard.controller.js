/**
 * Dashboard. Vive en el gateway y no tiene tablas propias: agrega lo que ya
 * guardan Contratos, Inmuebles y Financiero (regla dura 5).
 *
 * Todas sus rutas exigen PROPIETARIO en `dashboard.routes.js`, así que aquí el
 * `sub` del token es siempre el del dueño.
 *
 * ── ES EL CONTROLADOR QUE MÁS CAMBIA EN CADA EXTRACCIÓN, Y ÉSTA ES LA ÚLTIMA ─
 *
 * No es casualidad: es el único que toca los tres contextos a la vez, así que
 * cada servicio que sale le quita un `include`. El paso 4 le quitó el de
 * Inmuebles; el 6d el de Contratos; el 6e le quita el último que le quedaba —el
 * de sus propias cuentas de cobro, que ya no son suyas.
 *
 * A partir de aquí este controlador NO CONSULTA NINGUNA BASE. Ni ésta ni otra:
 * el gateway se quedó sin tablas, que es lo que el Capítulo 2 dice que tiene que
 * ser. Todo lo que devuelve sale de componer respuestas de otros tres servicios.
 *
 * ── CADA DATO EXTERNO SE PIDE UNA VEZ POR PETICIÓN, NO UNA POR MÉTRICA ──────
 *
 * Es lo que sostiene el diseño después de las tres extracciones. `obtenerResumen`
 * calcula seis cosas, y una llamada de red por cada una convertiría el dashboard
 * en la pantalla más lenta de la aplicación. Son TRES llamadas —los inmuebles del
 * propietario, sus contratos y las cuentas de cobro de esos contratos— y de
 * ellas salen las seis.
 *
 * Las dos primeras van en paralelo porque no dependen entre sí. La tercera no
 * puede: hasta que ms-contratos no dice cuáles son sus contratos, no se sabe qué
 * cuentas de cobro pedir.
 *
 * ── UN FALLO NO SE DEGRADA A CEROS ──────────────────────────────────────────
 *
 * Vale para los tres servicios, y desde el paso 6e importa más que nunca porque
 * el que aporta las cifras de dinero es el nuevo. Un dashboard que dice «0
 * contratos activos, $0 de ingresos» cuando en realidad no pudo preguntar es
 * peor que un error: PARECE una respuesta, y el propietario se la cree. Por eso
 * las tres llamadas propagan y aquí se traducen en 502.
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

/**
 * 502 con el formato de error del proyecto.
 *
 * El mensaje nombra el servicio que falló, porque ya son TRES y saber cuál
 * ahorra el rato de mirar tres logs.
 */
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

        // El `SUM` y el `COUNT` que hacía PostgreSQL se convierten en sumar una
        // lista en memoria. Son decenas de filas por propietario, no millones:
        // contarlas aquí cuesta menos que un endpoint de agregación en
        // ms-financiero que tendría que saber qué es un dashboard.
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

        // Los estados en UNA petición, y el `Op.or` que había se convierte en
        // un filtro sobre lo que vuelve. La condición no es simétrica —las
        // EN_MORA entran todas, las PENDIENTE y PARCIAL sólo si su corte ya
        // pasó— así que no cabía en un filtro de estado y se aplica aquí.
        //
        // PARCIAL entra por la misma razón que en el motor de ms-financiero: una
        // cuenta con saldo y el corte vencido debe, haya recibido abonos o no.
        const candidatas = await cuentasDeContratos(mios, [
            ESTADO_CUENTA_PENDIENTE,
            ESTADO_CUENTA_PARCIAL,
            ESTADO_CUENTA_EN_MORA
        ]);

        const enMora = candidatas.filter(
            (cuenta) => cuenta.estado === ESTADO_CUENTA_EN_MORA || cuenta.inicio < hoy
        );

        // `saldo_pendiente` ya viene derivado de ms-financiero: es lo único de
        // esa respuesta que el gateway no podría calcular, porque necesitaría
        // las transacciones.
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

        // La lista viene de ms-contratos, que aplica el filtro de pertenencia y
        // devuelve sólo los de sus inmuebles.
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

        // Las dos primeras en paralelo porque no dependen entre sí.
        const [inmuebles, contratos] = await Promise.all([
            dePropietario(sub),
            contratosDePropietario(sub)
        ]);

        const idsContratos = contratos.map((c) => c.id_contrato);

        // La tercera va después y no en paralelo: hasta que no se sabe cuáles
        // son sus contratos, no se sabe qué cuentas de cobro pedir. Los dos
        // estados que hacen falta viajan en la MISMA petición.
        const cuentas = await cuentasDeContratos(idsContratos, [
            ESTADO_CUENTA_PAGADA,
            ESTADO_CUENTA_PENDIENTE
        ]);

        const deEstado = (estado) => cuentas.filter((c) => c.estado === estado);

        // Contar sobre lo que ya se trajo en vez de pedir cuatro `COUNT`. Son
        // listas de decenas de filas, no de millones: contarlas en memoria
        // cuesta menos que cuatro viajes de red.
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
