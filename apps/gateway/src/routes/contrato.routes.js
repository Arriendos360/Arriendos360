const express = require('express');
const router = express.Router();
const {
    obtenerTodos,
    obtenerPorId,
    crear,
    actualizar,
    finalizar,
    reemitirContrasenaDelInquilino
} = require('../controllers/contrato.controller');
const {
    descargar: descargarAnexo,
    eliminar: eliminarAnexo,
    listar: listarAnexos,
    subir: subirAnexo
} = require('../controllers/anexo.controller');
const { verificarToken, esPropietario } = require('../middlewares/auth.middleware');
const { recibirArchivo } = require('../middlewares/upload.middleware');

// Todas las rutas de contratos requieren autenticación
router.use(verificarToken);

// GET /api/contratos
router.get('/', obtenerTodos);

// ── Anexos ──────────────────────────────────────────────────────────────
// Van ANTES de `/:id` para que `/:id/anexos` no lo capture la ruta de
// detalle. Express casa por orden de declaracion.
//
// Leer los anexos es de las dos partes; subir y borrar, solo del
// propietario. La matriz RBAC ya lo declara, y `esPropietario` lo vuelve a
// comprobar aqui: son las dos capas de la regla dura 8, y ninguna sustituye
// a la otra.
router.get('/:id/anexos', listarAnexos);
router.get('/:id/anexos/:idAnexo', descargarAnexo);
router.post('/:id/anexos', esPropietario, ...recibirArchivo('file'), subirAnexo);
router.delete('/:id/anexos/:idAnexo', esPropietario, eliminarAnexo);

// GET /api/contratos/:id
router.get('/:id', obtenerPorId);

// Rutas exclusivas para propietarios
//
// Crear un contrato ya NO acepta el PDF: el anexo es un paso aparte, porque
// necesita un `id_contrato` que todavia no existe cuando se firma. Ver
// `controllers/anexo.controller.js`.
router.post('/', esPropietario, crear);
router.put('/:id', esPropietario, actualizar);
router.put('/:id/finalizar', esPropietario, finalizar);

// POST /api/contratos/:id/contrasena-inquilino
// Reemision de la contrasena temporal del inquilino de este contrato.
router.post('/:id/contrasena-inquilino', esPropietario, reemitirContrasenaDelInquilino);

module.exports = router;