import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { listar, obtenerPorId } from '../controllers/interno.controller';

const router: Router = Router();

/** Todo `/interno` exige credencial de servicio, montada con `router.use`. */
router.use(
  exigirServicio({
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-contratos'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

// GET /interno/contratos?parte= | ?propietario= | ?inquilino= | ?ids= | ?inmueble=&estado= | ?estado=
router.get('/contratos', listar);

// GET /interno/contratos/:id[?propietario=]
router.get('/contratos/:id', obtenerPorId);

export default router;
