const express = require('express');
const router = express.Router();
const { 
    obtenerIngresos, 
    obtenerMora, 
    obtenerContratosActivos, 
    obtenerResumen 
} = require('../controllers/dashboard.controller');
const { verificarToken, esPropietario } = require('../middlewares/auth.middleware');

// Todas las rutas del dashboard requieren ser Propietario autenticado
router.use(verificarToken, esPropietario);

// GET /api/dashboard/ingresos
router.get('/ingresos', obtenerIngresos);

// GET /api/dashboard/mora
router.get('/mora', obtenerMora);

// GET /api/dashboard/contratos-activos
router.get('/contratos-activos', obtenerContratosActivos);

// GET /api/dashboard/resumen
router.get('/resumen', obtenerResumen);

module.exports = router;