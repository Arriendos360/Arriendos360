import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { listarCuentas } from '../controllers/interno.controller';
import { recibir } from '../controllers/eventos.controller';

const router: Router = Router();

/**
 * TODO endpoint de `/interno` exige credencial de servicio.
 *
 * Va como `router.use` y no ruta por ruta a proposito: asi un endpoint nuevo
 * nace protegido y no hay forma de olvidarse. Confianza cero (regla dura 7): que
 * la peticion venga de la red interna no la hace confiable, y menos aun cuando
 * el puerto esta publicado al host en desarrollo.
 *
 * Aqui importa el doble, porque los dos endpoints escriben o revelan dinero: uno
 * enumera las cuentas de cobro de unos contratos y el otro CREA una factura.
 */
router.use(
  exigirServicio({
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-financiero'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

// GET /interno/cuentas-cobro?contratos=a,b,c[&estado=PAGADA,EN_MORA]
// Lo llama el gateway para componer el dashboard.
router.get('/cuentas-cobro', listarCuentas);

// POST /interno/eventos — la entrada del bus.
// Este servicio CONSUME `ContratoFormalizado` y crea con el la primera cuenta de
// cobro. Es el caso que el Capitulo 2 especifica textualmente.
router.post('/eventos', recibir);

export default router;
