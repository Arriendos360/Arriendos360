import { Router } from 'express';
import { exigirServicio } from 'arriendos360-shared';

import { reemitirContrasenaTemporal, usuariosPorIds } from '../controllers/usuario.controller';
import { revocadosVigentes, sesionesInvalidadas } from '../services/tokenService';

const router: Router = Router();

/**
 * TODO endpoint de `/interno` exige credencial de servicio.
 *
 * Va como `router.use` y no ruta por ruta a proposito: asi un endpoint nuevo
 * nace protegido y no hay forma de olvidarse. Confianza cero (regla dura 7): que
 * la peticion venga de la red interna no la hace confiable, y menos aun cuando
 * el puerto esta publicado al host en desarrollo.
 */
router.use(
  exigirServicio({
    destinatario: process.env['SERVICIO_NOMBRE'] ?? 'ms-identidad',
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

/**
 * GET /interno/revocados
 *
 * Los `jti` revocados que siguen vigentes. El gateway lo consulta cada cierto
 * tiempo para mantener su copia en memoria y no tener que preguntar en cada
 * peticion (Capitulo 2, Revocacion de tokens).
 *
 * Cuelga de `/interno` y NO de `/api`: la costura del gateway solo reenvia
 * prefijos `/api/*`, asi que no es alcanzable a traves del gateway. Pero eso no
 * basta —el puerto esta publicado al host en Compose— y por eso exige credencial
 * de servicio, como todo lo que cuelga de `/interno`.
 */
router.get('/revocados', async (_req, res) => {
  try {
    // Dos listas, porque hay dos formas de invalidar un token: por `jti`
    // —logout— y en bloque comparando `iat` con la marca de cambio de
    // contrasena. Van juntas para que al gateway le baste un viaje.
    const [revocados, sesiones] = await Promise.all([revocadosVigentes(), sesionesInvalidadas()]);
    res.json({ revocados, sesiones, generado_en: new Date().toISOString() });
  } catch (error) {
    console.error('Error al listar revocados:', error);
    res.status(500).json({ mensaje: 'Error al listar revocados' });
  }
});

/**
 * GET /interno/usuarios?ids=...
 *
 * Datos de usuario en lote para que el gateway componga sus respuestas sin
 * cruzar la frontera con un JOIN. Ver el controlador.
 */
router.get('/usuarios', usuariosPorIds);

/**
 * POST /interno/usuarios/:id/contrasena-temporal
 *
 * Reemision de la contrasena temporal. La autorizacion de quien pide la hace el
 * gateway antes de llamar, porque la regla depende de los contratos y esos son
 * de otro servicio.
 */
router.post('/usuarios/:id/contrasena-temporal', reemitirContrasenaTemporal);

export default router;
