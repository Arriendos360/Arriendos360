const express = require('express');
const router = express.Router();
const { procesarContratos, procesarPagos } = require('../services/financialEngine');
const { verificarToken, esPropietario } = require('../middlewares/auth.middleware');

// POST /api/admin/ejecutar-motor
// Este endpoint dispara manualmente el proceso que normalmente corre a las 00:01
router.post('/ejecutar-motor', verificarToken, async (req, res) => {
    try {
        console.log('⚡ Ejecución manual del Motor Financiero solicitada...');
        await procesarContratos();
        await procesarPagos();
        res.json({ mensaje: 'Motor Financiero ejecutado manualmente con éxito' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al ejecutar motor', error: error.message });
    }
});

module.exports = router;
