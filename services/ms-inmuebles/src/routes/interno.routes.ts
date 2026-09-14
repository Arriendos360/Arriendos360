import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { recibir } from '../controllers/eventos.controller';
import { listar } from '../controllers/interno.controller';

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
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-inmuebles'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

// GET /interno/inmuebles?propietario=<uuid> | ?ids=<uuid>,<uuid>
router.get('/inmuebles', listar);

// POST /interno/eventos — entrada del bus. Ver `src/eventos/`.
router.post('/eventos', recibir);

// AQUI ESTABA `POST /interno/inmuebles/:id/estado`, que el gateway llamaba tras
// guardar un contrato. Lo reemplazo el consumo de `ContratoFormalizado` y
// `ContratoFinalizado`, y se retiro con el: no le quedaba ningun otro
// consumidor. Dejarlo «por si acaso» habria mantenido abierta una segunda
// puerta al estado del inmueble, con las dos consecuencias de siempre — una
// superficie que nadie prueba y un camino por el que reintroducir la escritura
// sincrona sin darse cuenta.

export default router;
