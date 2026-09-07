const express = require('express');

const { login, logout, registrar } = require('../controllers/auth.controller');
const { verificarToken } = require('../middlewares/auth.middleware');

const router = express.Router();

// POST /api/auth/registro — pública. Reemplaza a /register: CLAUDE.md resuelve
// que ganan los contratos de la sección de microservicios y el frontend se adapta.
router.post('/registro', registrar);

// POST /api/auth/login — pública.
router.post('/login', login);

// POST /api/auth/logout — protegida, cuerpo vacío, token en Authorization.
router.post('/logout', verificarToken, logout);

module.exports = router;
