/**
 * Arranque de MS-Financiero.
 *
 * Aplica sus migraciones antes de escuchar: el esquema `financiero` es suyo y de
 * nadie mas, asi que nadie mas puede prepararlo. Y ademas es lo que hace segura
 * la mudanza — `database/financiero/002` copia las cuentas de cobro que estaban
 * en `public` y retira el original en la misma transaccion, asi que el
 * healthcheck de Compose solo responde cuando eso ya ocurrio.
 *
 * ── ESTE SERVICIO NO ES PRODUCTOR, PERO SI CONSUMIDOR ──────────────────────
 *
 * No arranca publicador: no emite ningun evento todavia y por eso no tiene tabla
 * de salida. Lo que si hace es CONSUMIR `ContratoFormalizado` por
 * `POST /interno/eventos`, y eso no necesita arrancar nada aqui — el consumidor
 * es un manejador HTTP, no un proceso. Quien barre y entrega es el publicador de
 * ms-contratos.
 *
 * El dia que el motor publique eventos en vez de mandar correos (paso 7), este
 * arranque ganara su publicador y `database/financiero/` una tabla de salida.
 *
 * ── EL MOTOR ARRANCA AQUI, Y ESO TIENE FECHA DE CADUCIDAD ──────────────────
 *
 * `iniciarMotorFinanciero()` programa el barrido diario con `node-cron`, que
 * vive DENTRO de este proceso. Funciona mientras el proceso viva; con
 * scale-to-zero en Container Apps deja de hacerlo. Ver `services/motor.ts` y
 * `docs/adr/0018`.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones } from './database/migraciones';
import { cache, hayFuenteDeRevocacion } from './seguridad/cache';
import { consumidor } from './eventos';
import { iniciarMotorFinanciero } from './services/motor';

const PUERTO = Number(process.env['PORT'] ?? 3014);

const iniciar = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('✅ ms-financiero: conexión a PostgreSQL exitosa');

    const aplicadas = await aplicarMigraciones(sequelize);
    console.log(
      aplicadas.length > 0
        ? `✅ ms-financiero: migraciones aplicadas: ${aplicadas.join(', ')}`
        : '✅ ms-financiero: esquema al día, sin migraciones pendientes',
    );

    if (hayFuenteDeRevocacion()) {
      await cache.iniciar();
      const estado = cache.estado();
      console.log(
        `🔑 ms-financiero: caché de invalidación con ${estado.vigentes} tokens revocados y ` +
          `${estado.sesionesInvalidadas} sesiones caídas, refresco cada ${
            estado.intervaloMs / 1000
          }s` + `${estado.ultimoError ? ` — ÚLTIMO FALLO: ${estado.ultimoError}` : ''}`,
      );
    } else {
      // No se aborta el arranque, pero tampoco se calla: sin fuente, un token de
      // una sesion cerrada entra. Es aceptable en una prueba aislada y no lo es
      // en ningun despliegue.
      console.warn(
        '⚠️  ms-financiero: MS_IDENTIDAD_URL sin definir. NO se comprobará la revocación de tokens.',
      );
    }

    // No arranca nada: el consumidor es un manejador HTTP. Se cuenta lo que
    // lleva procesado porque es el numero que dice si el bus esta llegando.
    console.log(
      `📥 ms-financiero: consumidor del bus con ${await consumidor.contar()} eventos procesados. ` +
        'Escucha ContratoFormalizado en POST /interno/eventos.',
    );

    iniciarMotorFinanciero();

    app.listen(PUERTO, () => {
      console.log(`💰 ms-financiero escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-financiero: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
