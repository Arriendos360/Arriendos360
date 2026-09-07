import { Router } from 'express';

import { usuariosPorIds } from '../controllers/usuario.controller';
import { revocadosVigentes } from '../services/tokenService';

const router: Router = Router();

/**
 * GET /interno/revocados
 *
 * Los `jti` revocados que siguen vigentes. El gateway lo consulta cada cierto
 * tiempo para mantener su copia en memoria y no tener que preguntar en cada
 * peticion (Capitulo 2, Revocacion de tokens).
 *
 * Cuelga de `/interno` y NO de `/api` a proposito: la costura del gateway solo
 * reenvia prefijos `/api/*`, asi que esta ruta no es alcanzable desde fuera a
 * traves del gateway. Su unico control de acceso hoy es la red interna de
 * Compose.
 *
 * PENDIENTE al desplegar en Azure: ahi la red ya no es una frontera de
 * confianza y hace falta autenticacion entre servicios (mTLS o un token de
 * servicio). Anotado como decision abierta en CLAUDE.md.
 */
router.get('/revocados', async (_req, res) => {
  try {
    const revocados = await revocadosVigentes();
    res.json({ revocados, generado_en: new Date().toISOString() });
  } catch (error) {
    console.error('Error al listar revocados:', error);
    res.status(500).json({ mensaje: 'Error al listar revocados' });
  }
});

/**
 * GET /interno/usuarios?ids=...
 *
 * Datos de usuario en lote para que el gateway componga sus respuestas sin
 * cruzar la frontera con un JOIN. Ver el controlador.
 */
router.get('/usuarios', usuariosPorIds);

export default router;
