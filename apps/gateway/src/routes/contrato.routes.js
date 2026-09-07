const express = require('express');
const router = express.Router();
const {
    obtenerTodos,
    obtenerPorId,
    crear,
    actualizar,
    finalizar,
    reemitirContrasenaDelInquilino
} = require('../controllers/contrato.controller');
const { verificarToken, esPropietario } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

// Todas las rutas de contratos requieren autenticación
router.use(verificarToken);

// GET /api/contratos
router.get('/', obtenerTodos);

// GET /api/contratos/:id
router.get('/:id', obtenerPorId);

// Rutas exclusivas para propietarios
router.post('/', esPropietario, upload.single('pdf'), crear);
router.put('/:id', esPropietario, actualizar);
router.put('/:id/finalizar', esPropietario, finalizar);

// POST /api/contratos/:id/contrasena-inquilino
// Reemision de la contrasena temporal del inquilino de este contrato.
router.post('/:id/contrasena-inquilino', esPropietario, reemitirContrasenaDelInquilino);

module.exports = router;