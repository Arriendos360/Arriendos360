const express = require('express');
const router = express.Router();
const { 
    obtenerTodos, 
    obtenerPorId, 
    crear, 
    actualizar, 
    eliminar 
} = require('../controllers/inmueble.controller');
const { verificarToken, esPropietario } = require('../middlewares/auth.middleware');

// GET /api/inmuebles
router.get('/', verificarToken, obtenerTodos);

// GET /api/inmuebles/:id
router.get('/:id', verificarToken, obtenerPorId);

// POST /api/inmuebles
router.post('/', verificarToken, esPropietario, crear);

// PUT /api/inmuebles/:id
router.put('/:id', verificarToken, esPropietario, actualizar);

// DELETE /api/inmuebles/:id
router.delete('/:id', verificarToken, esPropietario, eliminar);

module.exports = router;