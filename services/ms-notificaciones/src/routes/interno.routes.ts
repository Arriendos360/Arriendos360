import { Router } from 'express';
import { exigirServicio, textoDeEntorno } from 'arriendos360-shared';

import { recibir } from '../controllers/eventos.controller';

const router: Router = Router();

/**
 * TODO endpoint de `/interno` exige credencial de servicio.
 *
 * Va como `router.use` y no ruta por ruta a proposito: asi un endpoint nuevo nace
 * protegido y no hay forma de olvidarse. Confianza cero (regla dura 7): que la
 * peticion venga de la red interna no la hace confiable, y menos cuando el puerto
 * esta publicado al host en desarrollo.
 *
 * ── Y ES LA UNICA PROTECCION QUE ESTE SERVICIO TIENE ────────────────────────
 *
 * No hay `verificarToken` en ninguna parte, porque no hay ninguna ruta a la que
 * llegue un token de usuario: este servicio no esta en la costura del gateway ni en
 * la matriz RBAC. Eso hace que esta linea cargue con todo, y conviene medir que
 * pasaria sin ella: cualquiera con acceso al puerto podria mandar un correo, con el
 * remitente del sistema y el texto de un aviso legitimo, a la direccion de
 * cualquier usuario cuyo UUID conociera. Es decir, una maquina de phishing con el
 * dominio del proyecto.
 */
router.use(
  exigirServicio({
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-notificaciones'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  }),
);

// POST /interno/eventos — la entrada del bus, y la unica de este servicio.
// Consume los cinco tipos del paso 7: los dos de ms-identidad —recuperacion de
// contrasena y contrasena temporal— y los tres de ms-financiero —cuenta generada,
// proxima a vencer y en mora.
router.post('/eventos', recibir);

export default router;
