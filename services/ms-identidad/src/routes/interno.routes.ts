import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { reemitirContrasenaTemporal, usuariosPorIds } from '../controllers/usuario.controller';
import { revocadosVigentes, sesionesInvalidadas } from '../services/tokenService';

const router: Router = Router();

/** Todo `/interno` exige credencial de servicio, montada con `router.use`. */
router.use(
  exigirServicio({
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-identidad'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

/**
 * GET /interno/revocados — los `jti` revocados vigentes y los cambios de
 * contraseña recientes, para las cachés de revocación.
 */
router.get('/revocados', async (_req, res) => {
  try {
    const [revocados, sesiones] = await Promise.all([revocadosVigentes(), sesionesInvalidadas()]);
    res.json({ revocados, sesiones, generado_en: new Date().toISOString() });
  } catch (error) {
    console.error('Error al listar revocados:', error);
    res.status(500).json({ mensaje: 'Error al listar revocados' });
  }
});

/** GET /interno/usuarios?ids=... — datos de usuario en lote. */
router.get('/usuarios', usuariosPorIds);

/** POST /interno/usuarios/:id/contrasena-temporal — reemite la contraseña temporal. */
router.post('/usuarios/:id/contrasena-temporal', reemitirContrasenaTemporal);

export default router;
