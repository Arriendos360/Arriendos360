/**
 * Un barrido del enviador, a mano: `npm run enviar --workspace=services/ms-notificaciones`.
 *
 * ── PARA QUE SIRVE ─────────────────────────────────────────────────────────
 *
 * Para dos cosas, y la segunda es la que importa de verdad.
 *
 * 1. Vaciar la cola en desarrollo sin esperar el barrido, cuando se quiere ver un
 *    correo salir en el momento.
 *
 * 2. Ser el equivalente de `npm run motor` de ms-financiero: un punto de entrada que
 *    hace el trabajo SIN depender de que la API escuche, y que sale con codigo
 *    distinto de cero si falla. Es la forma que un `Job` de Container Apps sabe
 *    ejecutar y evaluar.
 *
 * Hoy no hace falta para el despliegue, y conviene saber por que: el enviador de este
 * servicio NO tiene el problema que `docs/adr/0018` deja marcado como bloqueante para
 * el motor. Aquel necesita dispararse a una hora concreta, y un contenedor dormido a
 * las 00:01 no genera las cuentas del dia. Este no tiene hora: lo que le da trabajo
 * es un `POST /interno/eventos`, que es justamente lo que despierta al contenedor, y
 * `iniciar()` hace un barrido inmediato al arrancar.
 *
 * El unico hueco es un contenedor que se duerma con envios pendientes y no reciba
 * mas eventos, y para ese hueco existe este script. Si algun dia se quiere la
 * garantia en vez del «se arregla con el evento siguiente», el Bicep del paso 8 puede
 * programarlo igual que el motor, y no habra que escribir nada nuevo.
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

  // Un envio apartado no hace fallar el barrido: el barrido hizo su trabajo, y la
  // fila queda a la vista. Lo que hace fallar es no poder barrer.
  await sequelize.close();
};

ejecutar().catch(async (error) => {
  console.error('❌ ms-notificaciones: el barrido de envíos falló:', error);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
