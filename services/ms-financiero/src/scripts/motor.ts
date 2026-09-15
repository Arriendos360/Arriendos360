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
import { publicador } from '../eventos/salida';
import { ejecutarMotor } from '../services/motor';

/**
 * ── Y ENTREGA SUS AVISOS ANTES DE SALIR ────────────────────────────────────
 *
 * El motor solo anota sus eventos en `financiero.eventos_salida`; quien los entrega es el
 * publicador, que en Compose corre dentro del servicio. En Container Apps ms-financiero
 * escala a cero: si el Job solo anotara, los avisos del dia esperarian a que alguien
 * despertara al servicio. Por eso el Job barre la tabla antes de salir, varias veces y
 * con pausa, para dar tiempo a que ms-notificaciones despierte y a los reintentos.
 *
 * Lo que siga pendiente se queda en la tabla y lo entrega el publicador del servicio en
 * cuanto arranque. No hace fallar el Job: la facturacion ya esta hecha, y repetirla por un
 * aviso no aporta nada. Que otro publicador barra a la vez es inocuo: la entrega es
 * al-menos-una-vez y ms-notificaciones descarta repetidos.
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
  // Lo que el barrido no puede suplir con un defecto. Sin `MS_CONTRATOS_URL` o sin el
  // secreto de servicio no hay contratos que facturar, y un `Job` que termina en 0 sin
  // haber facturado nada es exactamente el fallo silencioso que esto tiene que evitar.
  //
  // `MS_NOTIFICACIONES_URL` tambien: sin suscriptores, el publicador da cada aviso por
  // entregado sin mandarlo a nadie y lo marca, asi que se perderia en silencio.
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
