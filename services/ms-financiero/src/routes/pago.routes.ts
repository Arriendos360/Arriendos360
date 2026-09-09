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
 * Rutas de Financiero.
 *
 * EL PREFIJO SIGUE SIENDO `/api/pagos`, aunque las tablas se llamen
 * `cuentas_cobro` y `transacciones`. Es el que fija el Capitulo 2 para
 * `POST /api/pagos` y es el que la costura del gateway reenvia aqui desde el
 * paso 6e; renombrarlo obligaria a tocar la costura, la matriz, el frontend y la
 * coleccion de Postman para no ganar nada.
 *
 * Las rutas y los verbos son EXACTAMENTE los que tenia el gateway:
 *
 *   POST /api/pagos                                 registra un pago (Cap. 2)
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
 *
 * `PUT /api/pagos/:id/pagar` NO EXISTE desde el paso 6c. Su trabajo lo hace
 * `POST /api/pagos`.
 */
const router: Router = Router();

// Todas las rutas exigen autenticacion. CONFIANZA CERO (regla dura 7): este
// servicio verifica el token por su cuenta aunque el gateway ya lo haya hecho.
router.use(verificarToken);

// ── Lecturas ────────────────────────────────────────────────────────────────
// Las lee cualquiera de las dos partes; que el recurso sea suyo lo comprueba el
// ABAC de cada handler.

router.get('/', obtenerTodos);
router.get('/pendientes', obtenerPendientes);
router.get('/historial-transacciones', obtenerHistorialGlobal);
router.get('/contrato/:id_contrato', obtenerPorContrato);

// RF-18. Va antes de `/:id/...` porque `transacciones` casaria con `:id`.
router.get('/transacciones/:id_transaccion/comprobante', generarComprobante);

router.get('/:id/recibo', generarRecibo);
router.get('/:id/transacciones', obtenerTransacciones);

// ── Escrituras ──────────────────────────────────────────────────────────────
// Todas exigen PROPIETARIO tambien aqui, no solo en la matriz del gateway: la
// regla dura 7 dice que ninguna capa se fia de que otra ya haya mirado.

router.post('/verificar-mora', esPropietario, verificarMora);
router.post('/cuentas-cobro', esPropietario, crearCuentaCobro);
router.post('/transacciones/:id_transaccion/anular', esPropietario, anularTransaccion);

// `POST /api/pagos` — RF-17. Va el ULTIMO de los POST porque es el mas general;
// declararlo antes no taparia a los otros (Express casa por ruta exacta), pero
// leerlo aqui deja claro que las tres anteriores son casos aparte.
router.post('/', esPropietario, registrarPago);

export default router;
