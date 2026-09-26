import { Router } from 'express';

import {
  anularTransaccion,
  crearCuentaCobro,
  generarComprobante,
  generarRecibo,
  obtenerHistorialGlobal,
  obtenerPendientes,
  obtenerPorContrato,
  obtenerTodos,
  obtenerTransacciones,
  registrarPago,
  verificarMora,
} from '../controllers/pago.controller';
import { esPropietario, verificarToken } from '../middlewares/auth.middleware';

/**
 * Rutas de Financiero, bajo `/api/pagos`:
 *
 *   POST /api/pagos                                 registra un pago
 *   POST /api/pagos/cuentas-cobro                   alta manual de una cuenta
 *   POST /api/pagos/transacciones/:id/anular        anula una transaccion
 *   POST /api/pagos/verificar-mora                  marca en mora las vencidas
 *   GET  /api/pagos                                 las cuentas del usuario
 *   GET  /api/pagos/pendientes                      las que quedan por cobrar
 *   GET  /api/pagos/historial-transacciones         todas las del usuario
 *   GET  /api/pagos/contrato/:id_contrato           las de un contrato
 *   GET  /api/pagos/:id/transacciones               las de una cuenta
 *   GET  /api/pagos/:id/recibo                      el PDF de una cuenta
 *   GET  /api/pagos/transacciones/:id/comprobante   el PDF de una transaccion
 */
const router: Router = Router();

// Todas las rutas exigen token.
router.use(verificarToken);

// ── Lecturas ────────────────────────────────────────────────────────────────
// Para las dos partes; la pertenencia la comprueba cada handler.

router.get('/', obtenerTodos);
router.get('/pendientes', obtenerPendientes);
router.get('/historial-transacciones', obtenerHistorialGlobal);
router.get('/contrato/:id_contrato', obtenerPorContrato);

// Antes de `/:id/...`, que la capturaría.
router.get('/transacciones/:id_transaccion/comprobante', generarComprobante);

router.get('/:id/recibo', generarRecibo);
router.get('/:id/transacciones', obtenerTransacciones);

// ── Escrituras ──────────────────────────────────────────────────────────────
// Sólo el propietario.

router.post('/verificar-mora', esPropietario, verificarMora);
router.post('/cuentas-cobro', esPropietario, crearCuentaCobro);
router.post('/transacciones/:id_transaccion/anular', esPropietario, anularTransaccion);

// `POST /api/pagos`: registrar un pago.
router.post('/', esPropietario, registrarPago);

export default router;
