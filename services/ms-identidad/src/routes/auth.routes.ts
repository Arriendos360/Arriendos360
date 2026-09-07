import { Router } from 'express';

import { cambiarContrasena, login, logout, registrar } from '../controllers/auth.controller';
import { verificarToken } from '../middlewares/auth.middleware';

const router: Router = Router();

// POST /api/auth/registro — publica. Crea siempre un PROPIETARIO.
router.post('/registro', registrar);

// POST /api/auth/login — publica.
router.post('/login', login);

// POST /api/auth/logout — protegida, cuerpo vacio.
router.post('/logout', verificarToken, logout);

// POST /api/auth/cambiar-contrasena — protegida. Unica ruta que un usuario con
// cambio obligatorio puede usar, aparte de login y logout.
router.post('/cambiar-contrasena', verificarToken, cambiarContrasena);

export default router;
