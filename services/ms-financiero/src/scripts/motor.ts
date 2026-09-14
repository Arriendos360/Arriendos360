/**
 * Disparo manual del motor financiero.
 *
 *   npm run motor --workspace=services/ms-financiero
 *   docker exec arriendos360_financiero npm run motor
 *
 * Sustituyo a `POST /api/admin/ejecutar-motor`, que se elimino en el paso 6c.
 * Aquel endpoint tenia dos problemas: el motor pertenece a este servicio y no al
 * gateway, y ademas importaba `esPropietario` sin aplicarlo, de modo que
 * cualquier usuario autenticado podia lanzar el proceso que genera cuentas de
 * cobro y marca morosos.
 *
 * ── Y ES ADEMAS EL CAMINO DE SALIDA DEL PROBLEMA DEL CRON ──────────────────
 *
 * `iniciarMotorFinanciero()` programa el barrido con `node-cron`, que es un
 * temporizador dentro del proceso: con scale-to-zero en Container Apps, un
 * contenedor dormido a medianoche no dispara nada. La solucion del paso 8 es un
 * trabajo programado que levante un contenedor, ejecute ESTO y se apague.
 *
 * Es decir, este script no es solo una comodidad de demostracion: es el punto de
 * entrada que el despliegue va a usar. Por eso no depende de que la API este
 * escuchando y por eso cierra la conexion y sale con codigo distinto de cero si
 * algo falla — un `Job` de Container Apps se da por fallido leyendo ese codigo.
 * Ver `docs/adr/0018`.
 */

import { validarEntorno } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { procesarContratos, procesarPagos } from '../services/motor';

const ejecutar = async (): Promise<void> => {
  // Lo que el barrido no puede suplir con un defecto. Sin `MS_CONTRATOS_URL` o sin el
  // secreto de servicio no hay contratos que facturar, y un `Job` que termina en 0 sin
  // haber facturado nada es exactamente el fallo silencioso del cron. Mejor que salga ≠ 0.
  validarEntorno('motor financiero', ['DB_PASSWORD', 'SERVICIO_JWT_SECRET', 'MS_CONTRATOS_URL']);

  console.log('⚡ Motor financiero: ejecución manual');

  await sequelize.authenticate();

  console.log('   → generando cuentas de cobro de los periodos siguientes...');
  await procesarContratos();

  console.log('   → revisando vencimientos y mora...');
  await procesarPagos();

  console.log('✅ Motor financiero ejecutado.');
};

ejecutar()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error('❌ Error al ejecutar el motor financiero:', error);
    await sequelize.close();
    process.exit(1);
  });
