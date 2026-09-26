/**
 * Ejecución del motor financiero desde la terminal y como comando del Job
 * programado. Sale con 1 si hubo algún fallo, para que el Job reintente.
 *
 *   npm run motor --workspace=services/ms-financiero
 *   docker exec arriendos360_financiero npm run motor
 */

import { validarEntorno } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { publicador } from '../eventos/salida';
import { ejecutarMotor } from '../services/motor';

/**
 * Antes de salir, entrega los avisos anotados con varios barridos del publicador.
 * Lo que quede pendiente lo entrega el servicio al arrancar y no hace fallar el Job.
 */
const BARRIDOS_DE_ENTREGA = 12;
const PAUSA_ENTRE_BARRIDOS_MS = 10_000;

const entregarAvisos = async (): Promise<{ entregados: number; pendientes: number }> => {
  let entregados = 0;
  for (let barrido = 1; ; barrido++) {
    const resultado = await publicador.ciclo();
    entregados += resultado.entregados;
    const pendientes = resultado.fallidos + resultado.aplazados;
    if (pendientes === 0 || barrido === BARRIDOS_DE_ENTREGA) {
      return { entregados, pendientes };
    }
    await new Promise((resolver) => setTimeout(resolver, PAUSA_ENTRE_BARRIDOS_MS));
  }
};

const ejecutar = async (): Promise<void> => {
  // Sin `MS_NOTIFICACIONES_URL` los avisos se marcarían entregados sin enviarse.
  validarEntorno('motor financiero', [
    'DB_PASSWORD',
    'SERVICIO_JWT_SECRET',
    'MS_CONTRATOS_URL',
    'MS_NOTIFICACIONES_URL',
  ]);

  console.log('⚡ Motor financiero: ejecución');

  await sequelize.authenticate();

  const resultado = await ejecutarMotor();

  console.log(
    `   → ${resultado.generadas} cuenta(s) de cobro generada(s), ` +
      `${resultado.moras} cuenta(s) marcada(s) en mora.`,
  );

  const entrega = await entregarAvisos();
  console.log(
    `   → ${entrega.entregados} aviso(s) entregado(s)` +
      (entrega.pendientes > 0
        ? `, ${entrega.pendientes} pendiente(s): los entregara ms-financiero al despertar.`
        : '.'),
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
