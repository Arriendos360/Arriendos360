import { Router } from 'express';

import {
  descargar as descargarAnexo,
  eliminar as eliminarAnexo,
  listar as listarAnexos,
  subir as subirAnexo,
} from '../controllers/anexo.controller';
import {
  actualizar,
  crear,
  finalizar,
  obtenerPorId,
  obtenerTodos,
  reemitirContrasenaDelInquilino,
} from '../controllers/contrato.controller';
import { esPropietario, verificarToken } from '../middlewares/auth.middleware';
import { recibirArchivo } from '../middlewares/upload.middleware';

const router: Router = Router();

// Todas las rutas exigen token.
router.use(verificarToken);

// GET /api/contratos
router.get('/', obtenerTodos);

// ── Anexos ────────────────────────────────────────────────────────────────
// Antes de `/:id`, que los capturaría. Leer es de las dos partes; subir y
// borrar, del propietario.
router.get('/:id/anexos', listarAnexos);
router.get('/:id/anexos/:idAnexo', descargarAnexo);
router.post('/:id/anexos', esPropietario, ...recibirArchivo('file'), subirAnexo);
router.delete('/:id/anexos/:idAnexo', esPropietario, eliminarAnexo);

// GET /api/contratos/:id
router.get('/:id', obtenerPorId);

// Rutas exclusivas para propietarios.
router.post('/', esPropietario, crear);
router.put('/:id', esPropietario, actualizar);
router.put('/:id/finalizar', esPropietario, finalizar);

// POST /api/contratos/:id/contrasena-inquilino
router.post('/:id/contrasena-inquilino', esPropietario, reemitirContrasenaDelInquilino);

export default router;
