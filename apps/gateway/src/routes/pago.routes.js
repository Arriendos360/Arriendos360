const express = require('express');
const router = express.Router();
const {
    anularTransaccion,
    crearCuentaCobro,
    generarComprobante,
    generarRecibo,
    obtenerHistorialGlobal,
    obtenerPendientes,
    obtenerPorContrato,
    obtenerTodos,
    obtenerTransacciones,
    registrarPago,
    verificarMora
} = require('../controllers/pago.controller');
const { verificarToken, esPropietario } = require('../middlewares/auth.middleware');

/**
 * Rutas de Financiero.
 *
 * EL PREFIJO SIGUE SIENDO `/api/pagos` a propósito, aunque las tablas ya se
 * llamen `cuentas_cobro` y `transacciones`. Es el que fija el Capítulo 2 para
 * `POST /api/pagos` y es el que la costura de enrutamiento mandará a
 * ms-financiero en el paso 6d; renombrarlo obligaría a tocar la costura, la
 * matriz y la colección de Postman para no ganar nada.
 *
 * Lo que sí cambió de forma son los verbos y los recursos que cuelgan:
 *
 *   POST /api/pagos                                 registra un pago (Cap. 2)
 *   POST /api/pagos/cuentas-cobro                   alta manual de una cuenta
 *   POST /api/pagos/transacciones/:id/anular        anula una transacción
 *   GET  /api/pagos/:id/transacciones               las de una cuenta
 *   GET  /api/pagos/transacciones/:id/comprobante   el PDF de una
 *   GET  /api/pagos/historial-transacciones         todas las del usuario
 *
 * `PUT /api/pagos/:id/pagar` YA NO EXISTE. Su trabajo lo hace `POST /api/pagos`.
 */

// Todas las rutas de pagos requieren autenticación
router.use(verificarToken);

// ── Lecturas ────────────────────────────────────────────────────────────────
// GET /api/pagos
router.get('/', obtenerTodos);

// GET /api/pagos/pendientes
router.get('/pendientes', obtenerPendientes);

// GET /api/pagos/historial-transacciones
router.get('/historial-transacciones', obtenerHistorialGlobal);

// GET /api/pagos/contrato/:id_contrato
router.get('/contrato/:id_contrato', obtenerPorContrato);

// GET /api/pagos/transacciones/:id_transaccion/comprobante — RF-18
router.get('/transacciones/:id_transaccion/comprobante', generarComprobante);

// GET /api/pagos/:id/recibo
router.get('/:id/recibo', generarRecibo);

// GET /api/pagos/:id/transacciones
router.get('/:id/transacciones', obtenerTransacciones);

// ── Escrituras ──────────────────────────────────────────────────────────────
// Todas exigen PROPIETARIO también aquí, no sólo en la matriz: la regla dura 7
// dice que ninguna capa se fía de que otra ya haya mirado.

// POST /api/pagos/verificar-mora
router.post('/verificar-mora', esPropietario, verificarMora);

// POST /api/pagos/cuentas-cobro
router.post('/cuentas-cobro', esPropietario, crearCuentaCobro);

// POST /api/pagos/transacciones/:id_transaccion/anular
router.post('/transacciones/:id_transaccion/anular', esPropietario, anularTransaccion);

// POST /api/pagos — RF-17. Va el ÚLTIMO de los POST porque es el más general;
// declararlo antes no la taparía (Express casa por ruta exacta), pero leerlo
// aquí deja claro que las tres anteriores son casos aparte y no excepciones.
router.post('/', esPropietario, registrarPago);

module.exports = router;
