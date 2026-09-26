import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { listarCuentas } from '../controllers/interno.controller';
import { recibir } from '../controllers/eventos.controller';

const router: Router = Router();

/** Todo `/interno` exige credencial de servicio, montada con `router.use`. */
router.use(
  exigirServicio({
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-financiero'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

// GET /interno/cuentas-cobro?contratos=a,b,c[&estado=PAGADA,EN_MORA] — para el dashboard.
router.get('/cuentas-cobro', listarCuentas);

// POST /interno/eventos — entrada del bus.
router.post('/eventos', recibir);

export default router;
