import { Router } from 'express';

import {
  actualizar,
  crear,
  eliminar,
  obtenerPorId,
  obtenerTodos,
} from '../controllers/inmueble.controller';
import { esPropietario, verificarToken } from '../middlewares/auth.middleware';

const router: Router = Router();

/** Todas exigen token y rol de propietario. */
router.use(verificarToken, esPropietario);

// GET /api/inmuebles
router.get('/', obtenerTodos);

// GET /api/inmuebles/:id
router.get('/:id', obtenerPorId);

// POST /api/inmuebles
router.post('/', crear);

// PUT /api/inmuebles/:id
router.put('/:id', actualizar);

// DELETE /api/inmuebles/:id
router.delete('/:id', eliminar);

export default router;
