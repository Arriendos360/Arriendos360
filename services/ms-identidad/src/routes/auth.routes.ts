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

// Las rutas públicas llevan límite por IP; los límites por cuenta los aplica el controlador.

// POST /api/auth/registro — publica. Crea siempre un PROPIETARIO.
router.post('/registro', limitarPorIp('registroPorIp'), registrar);

// POST /api/auth/login — publica.
router.post('/login', limitarPorIp('loginPorIp'), login);

// POST /api/auth/recuperar — pública. Responde siempre lo mismo.
router.post('/recuperar', limitarPorIp('recuperarPorIp'), recuperar);

// POST /api/auth/restablecer — publica. El token del enlace hace de credencial.
router.post('/restablecer', limitarPorIp('restablecerPorIp'), restablecer);

// POST /api/auth/logout — protegida, cuerpo vacio.
router.post('/logout', verificarToken, logout);

// POST /api/auth/cambiar-contrasena — protegida.
router.post('/cambiar-contrasena', verificarToken, cambiarContrasena);

export default router;
