const express = require('express');
const router = express.Router();
const { registrar, login } = require('../controllers/auth.controller');

// POST /api/auth/register
router.post('/register', registrar);

// POST /api/auth/login
router.post('/login', login);

module.exports = router;