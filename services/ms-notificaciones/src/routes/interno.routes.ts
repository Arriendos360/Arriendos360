import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { recibir } from '../controllers/eventos.controller';

const router: Router = Router();

/**
 * Todo `/interno` exige credencial de servicio, montada con `router.use`. Es la
 * única protección del servicio, que no tiene rutas públicas.
 */
router.use(
  exigirServicio({
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-notificaciones'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

// POST /interno/eventos — entrada del bus.
router.post('/eventos', recibir);

export default router;
