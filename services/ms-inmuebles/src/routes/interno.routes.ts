import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { recibir } from '../controllers/eventos.controller';
import { listar } from '../controllers/interno.controller';

const router: Router = Router();

/** Todo `/interno` exige credencial de servicio, montada con `router.use`. */
router.use(
  exigirServicio({
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-inmuebles'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

// GET /interno/inmuebles?propietario=<uuid> | ?ids=<uuid>,<uuid>
router.get('/inmuebles', listar);

// POST /interno/eventos — entrada del bus.
router.post('/eventos', recibir);

export default router;
