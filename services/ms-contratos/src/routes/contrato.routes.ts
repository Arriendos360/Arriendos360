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

// Todas las rutas de contratos requieren autenticacion. Confianza cero: se
// verifica aqui aunque el gateway ya lo haya hecho (regla dura 7).
router.use(verificarToken);

// GET /api/contratos
router.get('/', obtenerTodos);

// ── Anexos ────────────────────────────────────────────────────────────────
// Van ANTES de `/:id` para que `/:id/anexos` no lo capture la ruta de detalle.
// Express casa por orden de declaracion.
//
// Leer los anexos es de las dos partes; subir y borrar, solo del propietario.
// La matriz RBAC del gateway ya lo declara, y `esPropietario` lo vuelve a
// comprobar aqui: son las dos capas de la regla dura 8, y ninguna sustituye a
// la otra.
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
