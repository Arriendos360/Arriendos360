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
 * ── Y ES EL COMANDO DEL TRABAJO PROGRAMADO ─────────────────────────────────
 *
 * En Container Apps el motor no lo programa el servicio: lo ejecuta un Job que
 * levanta la misma imagen, corre ESTO y se apaga (`docs/adr/0021`). Por eso no
 * depende de que la API este escuchando, y por eso sale con 1 si hubo cualquier
 * fallo: un Job se da por fallido leyendo ese codigo, y entonces reintenta.
 *
 * Reintentar es seguro. El motor es idempotente —ver la cabecera de
 * `services/motor.ts`—, asi que una segunda ejecucion solo hace lo que falto.
 */

import { validarEntorno } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { ejecutarMotor } from '../services/motor';

const ejecutar = async (): Promise<void> => {
  // Lo que el barrido no puede suplir con un defecto. Sin `MS_CONTRATOS_URL` o sin el
  // secreto de servicio no hay contratos que facturar, y un `Job` que termina en 0 sin
  // haber facturado nada es exactamente el fallo silencioso que esto tiene que evitar.
  validarEntorno('motor financiero', ['DB_PASSWORD', 'SERVICIO_JWT_SECRET', 'MS_CONTRATOS_URL']);

  console.log('⚡ Motor financiero: ejecución');

  await sequelize.authenticate();

  const resultado = await ejecutarMotor();

  console.log(
    `   → ${resultado.generadas} cuenta(s) de cobro generada(s), ` +
      `${resultado.moras} cuenta(s) marcada(s) en mora.`,
  );

  if (resultado.fallos.length > 0) {
    throw new Error(
      `el motor terminó con ${resultado.fallos.length} fallo(s): ${resultado.fallos.join('; ')}`,
    );
  }

  console.log('✅ Motor financiero ejecutado.');
};

ejecutar()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error('❌ Error al ejecutar el motor financiero:', error);
    await sequelize.close();
    process.exit(1);
  });
