import { Router } from 'express';

import { buscarPorDocumento, crearInquilino } from '../controllers/usuario.controller';
import { esPropietario, verificarToken } from '../middlewares/auth.middleware';

const router: Router = Router();

// Todas exigen propietario autenticado.
router.use(verificarToken, esPropietario);

// GET /api/usuarios?documento=...
router.get('/', buscarPorDocumento);

// POST /api/usuarios/inquilinos
router.post('/inquilinos', crearInquilino);

export default router;
