import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { listar, obtenerPorId } from '../controllers/interno.controller';

const router: Router = Router();

/**
 * TODO endpoint de `/interno` exige credencial de servicio.
 *
 * Va como `router.use` y no ruta por ruta a proposito: asi un endpoint nuevo
 * nace protegido y no hay forma de olvidarse. Confianza cero (regla dura 7): que
 * la peticion venga de la red interna no la hace confiable, y menos aun cuando
 * el puerto esta publicado al host en desarrollo.
 *
 * Aqui importa especialmente: estos endpoints responden «de quien es este
 * contrato», y sin credencial cualquiera con acceso al puerto podria enumerar
 * los contratos de cualquier propietario.
 */
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

// NO hay `POST /interno/eventos`: este servicio PRODUCE eventos, no los consume.
// El dia que consuma alguno —hoy no hay ninguno que le interese— entrara por
// aqui con el mismo mecanismo de `packages/shared` que usa ms-inmuebles.

export default router;
