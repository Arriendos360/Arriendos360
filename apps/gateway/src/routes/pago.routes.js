const express = require('express');
const router = express.Router();
const { 
    obtenerTodos, 
    obtenerPorContrato, 
    crear, 
    registrarPago, 
    obtenerPendientes,
    verificarMora,
    generarRecibo,
    obtenerAbonos,
    generarComprobanteAbono,
    obtenerHistorialGlobalAbonos
} = require('../controllers/pago.controller');
const { verificarToken, esPropietario } = require('../middlewares/auth.middleware');

// Todas las rutas de pagos requieren autenticación
router.use(verificarToken);

// GET /api/pagos
router.get('/', obtenerTodos);

// GET /api/pagos/pendientes
router.get('/pendientes', obtenerPendientes);

// GET /api/pagos/contrato/:id_contrato
router.get('/contrato/:id_contrato', obtenerPorContrato);

// GET /api/pagos/historial-abonos
router.get('/historial-abonos', obtenerHistorialGlobalAbonos);

// POST /api/pagos/verificar-mora
router.post('/verificar-mora', esPropietario, verificarMora);

// POST /api/pagos
router.post('/', esPropietario, crear);

// PUT /api/pagos/:id/pagar
router.put('/:id/pagar', registrarPago);

// GET /api/pagos/:id/recibo
router.get('/:id/recibo', generarRecibo);

// GET /api/pagos/:id/abonos
router.get('/:id/abonos', obtenerAbonos);

// GET /api/pagos/abono/:id_abono
router.get('/abono/:id_abono', generarComprobanteAbono);

module.exports = router;