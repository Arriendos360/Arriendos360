const jwt = require('jsonwebtoken');

const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Acepta token por header O por query param (para window.open y descargas)
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) {
        return res.status(401).json({ mensaje: 'Acceso denegado. No se proporcionó un token.' });
    }

    try {
        const verificado = jwt.verify(token, process.env.JWT_SECRET);
        req.usuario = verificado;
        next();
    } catch (error) {
        res.status(403).json({ mensaje: 'Token no válido o expirado.' });
    }
};

const esPropietario = (req, res, next) => {
    if (req.usuario && req.usuario.rol === 'propietario') {
        next();
    } else {
        res.status(403).json({ mensaje: 'Acceso restringido. Se requiere rol de propietario.' });
    }
};

module.exports = { verificarToken, esPropietario };