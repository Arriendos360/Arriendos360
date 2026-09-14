/**
 * Arranque de MS-Financiero.
 *
 * Aplica sus migraciones antes de escuchar: el esquema `financiero` es suyo y de
 * nadie mas, asi que nadie mas puede prepararlo. Y ademas es lo que hace segura
 * la mudanza — `database/financiero/002` copia las cuentas de cobro que estaban
 * en `public` y retira el original en la misma transaccion, asi que el
 * healthcheck de Compose solo responde cuando eso ya ocurrio.
 *
 * ── ES CONSUMIDOR Y, DESDE EL PASO 7, TAMBIEN PRODUCTOR ────────────────────
 *
 * El parrafo que habia aqui decia: «el dia que el motor publique eventos en vez de
 * mandar correos (paso 7), este arranque ganara su publicador y `database/financiero/`
 * una tabla de salida». Ese dia es este.
 *
 * CONSUMIDOR de `ContratoFormalizado`, por `POST /interno/eventos`. Eso no necesita
 * arrancar nada: el consumidor es un manejador HTTP, no un proceso.
 *
 * PRODUCTOR de `CuentaCobroGenerada`, `CuentaCobroPorVencer` y `CuentaCobroEnMora`,
 * con su tabla de salida en `financiero.eventos_salida` y su publicador, que SI es un
 * proceso y arranca aqui. Como en los otros dos productores, se arranca en el servidor
 * y no al cargar el modulo: un temporizador corriendo durante una suite haria que las
 * entregas ocurrieran en momentos que la prueba no controla.
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
import { enteroDeEntorno, validarEntorno } from 'arriendos360-shared';

import { cache } from './seguridad/cache';
import { consumidor } from './eventos';
import { almacen, publicador } from './eventos/salida';
import { iniciarMotorFinanciero } from './services/motor';

const PUERTO = enteroDeEntorno('PORT', 3014);

/**
 * Lo que no tiene defecto razonable. Sin `MS_IDENTIDAD_URL` entraban tokens de
 * sesiones cerradas; sin `MS_NOTIFICACIONES_URL` los avisos del motor se daban por
 * entregados sin que saliera un correo; sin `MS_CONTRATOS_URL` no hay nada que
 * facturar. Los dos primeros arrancaban con un aviso en el log; ahora no arrancan.
 */
const OBLIGATORIAS = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'SERVICIO_JWT_SECRET',
  'MS_CONTRATOS_URL',
  'MS_IDENTIDAD_URL',
  'MS_NOTIFICACIONES_URL',
];

const iniciar = async (): Promise<void> => {
  try {
    validarEntorno('ms-financiero', OBLIGATORIAS);

    await sequelize.authenticate();
    console.log('✅ ms-financiero: conexión a PostgreSQL exitosa');

    const aplicadas = await aplicarMigraciones(sequelize);
    console.log(
      aplicadas.length > 0
        ? `✅ ms-financiero: migraciones aplicadas: ${aplicadas.join(', ')}`
        : '✅ ms-financiero: esquema al día, sin migraciones pendientes',
    );

    await cache.iniciar();
    const estado = cache.estado();
    console.log(
      `🔑 ms-financiero: caché de invalidación con ${estado.vigentes} tokens revocados y ` +
        `${estado.sesionesInvalidadas} sesiones caídas, refresco cada ${
          estado.intervaloMs / 1000
        }s` + `${estado.ultimoError ? ` — ÚLTIMO FALLO: ${estado.ultimoError}` : ''}`,
    );

    // No arranca nada: el consumidor es un manejador HTTP. Se cuenta lo que
    // lleva procesado porque es el numero que dice si el bus esta llegando.
    console.log(
      `📥 ms-financiero: consumidor del bus con ${await consumidor.contar()} eventos procesados. ` +
        'Escucha ContratoFormalizado en POST /interno/eventos.',
    );

    // Y desde el paso 7, la otra mitad: el publicador de sus propios eventos. Su
    // suscriptor, `MS_NOTIFICACIONES_URL`, ya lo exigio `validarEntorno`.
    const pendientes = await almacen.contar();
    await publicador.iniciar();
    const estadoPublicador = publicador.estado();
    console.log(
      `📤 ms-financiero: publicador en marcha cada ${estadoPublicador.intervaloMs / 1000}s — ` +
        `${pendientes.pendientes} evento(s) pendiente(s), ${pendientes.apartados} apartado(s).`,
    );

    if (pendientes.apartados > 0) {
      console.warn(
        `⚠️  ms-financiero: ${pendientes.apartados} evento(s) APARTADO(S) en ` +
          'financiero.eventos_salida. No se reintentan solos: hay que mirar su ' +
          'ultimo_error y reencolarlos.',
      );
    }

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
