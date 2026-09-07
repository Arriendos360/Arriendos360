import { Router } from 'express';
import { exigirServicio } from 'arriendos360-shared';

import { cambiarEstado, listar } from '../controllers/interno.controller';

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
    destinatario: process.env['SERVICIO_NOMBRE'] ?? 'ms-inmuebles',
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

// GET /interno/inmuebles?propietario=<uuid> | ?ids=<uuid>,<uuid>
router.get('/inmuebles', listar);

// POST /interno/inmuebles/:id/estado
router.post('/inmuebles/:id/estado', cambiarEstado);

export default router;
