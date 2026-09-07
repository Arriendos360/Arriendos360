const express = require('express');

const { buscarPorDocumento, crearInquilino } = require('../controllers/usuario.controller');
const { esPropietario, verificarToken } = require('../middlewares/auth.middleware');

const router = express.Router();

// Ninguna de las dos es pública: buscar personas por documento y dar de alta
// usuarios son operaciones de un propietario en curso de firmar un contrato.
router.use(verificarToken, esPropietario);

// GET /api/usuarios/buscar?documento=...
router.get('/buscar', buscarPorDocumento);

// POST /api/usuarios/inquilinos
router.post('/inquilinos', crearInquilino);

module.exports = router;
