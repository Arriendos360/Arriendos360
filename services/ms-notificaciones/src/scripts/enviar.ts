/**
 * Un barrido del enviador, a mano: `npm run enviar --workspace=services/ms-notificaciones`.
 * No depende de que la API escuche y sale con 1 si no puede barrer.
 */

import { validarEntorno } from 'arriendos360-shared';

import { sequelize } from '../config/database';
import { enviador } from '../services/enviador';

const ejecutar = async (): Promise<void> => {
  validarEntorno('barrido de envíos', ['DB_PASSWORD']);

  const resultado = await enviador.ciclo();

  console.log(
    `✉️  ms-notificaciones: ${resultado.enviados} enviado(s), ${resultado.fallidos} fallido(s), ` +
      `${resultado.apartados} apartado(s), ${resultado.aplazados} aplazado(s).`,
  );

  // Un envío apartado no hace fallar el barrido.
  await sequelize.close();
};

ejecutar().catch(async (error) => {
  console.error('❌ ms-notificaciones: el barrido de envíos falló:', error);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
