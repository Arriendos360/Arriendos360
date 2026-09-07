import { Router } from 'express';

import { login, logout, registrar } from '../controllers/auth.controller';
import { verificarToken } from '../middlewares/auth.middleware';

const router: Router = Router();

// POST /api/auth/registro — publica. Crea siempre un PROPIETARIO.
router.post('/registro', registrar);

// POST /api/auth/login — publica.
router.post('/login', login);

// POST /api/auth/logout — protegida, cuerpo vacio.
router.post('/logout', verificarToken, logout);

export default router;
