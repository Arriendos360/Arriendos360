import { Router } from 'express';

import {
  cambiarContrasena,
  login,
  logout,
  recuperar,
  registrar,
  restablecer,
} from '../controllers/auth.controller';
import { verificarToken } from '../middlewares/auth.middleware';
import { limitarPorIp } from '../services/limites';

const router: Router = Router();

// Las cuatro rutas publicas llevan limite por IP delante del controlador. Los
// limites por cuenta los aplica el propio controlador, que es quien lee el correo.
// Ver `services/limites.ts` y `docs/adr/0020`.

// POST /api/auth/registro — publica. Crea siempre un PROPIETARIO.
router.post('/registro', limitarPorIp('registroPorIp'), registrar);

// POST /api/auth/login — publica.
router.post('/login', limitarPorIp('loginPorIp'), login);

// POST /api/auth/recuperar — publica. Responde siempre lo mismo, exista o no la
// cuenta: si no, seria un verificador de correos registrados.
router.post('/recuperar', limitarPorIp('recuperarPorIp'), recuperar);

// POST /api/auth/restablecer — publica. El token del enlace hace de credencial.
router.post('/restablecer', limitarPorIp('restablecerPorIp'), restablecer);

// POST /api/auth/logout — protegida, cuerpo vacio.
router.post('/logout', verificarToken, logout);

// POST /api/auth/cambiar-contrasena — protegida. Unica ruta que un usuario con
// cambio obligatorio puede usar, aparte de login y logout.
router.post('/cambiar-contrasena', verificarToken, cambiarContrasena);

export default router;
