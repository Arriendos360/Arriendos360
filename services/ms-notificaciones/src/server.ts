/**
 * Arranque de MS-Notificaciones: valida el entorno, aplica o comprueba las
 * migraciones, informa el estado de la bitácora, arranca el enviador y escucha.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones, migracionesPendientes } from './database/migraciones';
import { consumidor } from './eventos';
import { esSimulado } from './config/mailer';
import { contarEnvios, enviador } from './services/enviador';
import { enteroDeEntorno, validarEntorno, siNoDeEntorno } from 'arriendos360-shared';

const PUERTO = enteroDeEntorno('PORT', 3015);

/**
 * Variables obligatorias. Sin `MS_IDENTIDAD_URL` no se puede resolver ningún
 * destinatario. `EMAIL_USER` es opcional: sin ella los correos se simulan.
 */
const OBLIGATORIAS = [
  'DB_PASSWORD',
  'SERVICIO_JWT_SECRET',
  'MS_IDENTIDAD_URL',
  'MIGRACIONES_AL_ARRANCAR',
];

const iniciar = async (): Promise<void> => {
  try {
    validarEntorno('ms-notificaciones', OBLIGATORIAS);

    await sequelize.authenticate();
    console.log('✅ ms-notificaciones: conexión a PostgreSQL exitosa');

    // Con MIGRACIONES_AL_ARRANCAR=no sólo comprueba que no falte ninguna.
    if (siNoDeEntorno('MIGRACIONES_AL_ARRANCAR')) {
      const aplicadas = await aplicarMigraciones(sequelize);
      console.log(
        aplicadas.length > 0
          ? `✅ ms-notificaciones: migraciones aplicadas: ${aplicadas.join(', ')}`
          : '✅ ms-notificaciones: esquema al día, sin migraciones pendientes',
      );
    } else {
      const pendientes = await migracionesPendientes(sequelize);
      if (pendientes.length > 0) {
        throw new Error(
          `ms-notificaciones: MIGRACIONES_AL_ARRANCAR=no y hay migraciones pendientes: ${pendientes.join(', ')}. ` +
            'Aplícalas antes con el Job de migración (node dist/database/aplicar.js).',
        );
      }
      console.log('✅ ms-notificaciones: esquema al día (las migraciones las aplica el Job, no este proceso)');
    }

    // El consumidor es un manejador HTTP: sólo se informa lo procesado.
    console.log(
      `📥 ms-notificaciones: consumidor del bus con ${await consumidor.contar()} eventos ` +
        'procesados. Escucha 5 tipos en POST /interno/eventos.',
    );

    const envios = await contarEnvios();
    console.log(
      `✉️  ms-notificaciones: bitácora con ${envios.enviados} enviados y ` +
        `${envios.pendientes} pendientes.`,
    );

    // `enviando` y `apartado` no se resuelven solos.
    if (envios.enviando > 0 || envios.apartados > 0) {
      console.warn(
        `⚠️  ms-notificaciones: ${envios.enviando} envío(s) quedaron en «enviando» y ` +
          `${envios.apartados} están apartados. NINGUNO se va a reintentar solo — los ` +
          'primeros porque no se sabe si salieron y repetir un correo es peor que no ' +
          'mandarlo, los segundos porque agotaron sus intentos. Consulta ' +
          'notificaciones.envios.',
      );
    }

    await enviador.iniciar();
    const estado = enviador.estado();
    console.log(
      `🚀 ms-notificaciones: enviador en marcha, barrido cada ${estado.intervaloMs / 1000}s, ` +
        `${estado.maxIntentos} intentos por envío.`,
    );

    // Sin EMAIL_USER los correos no salen de la máquina.
    if (esSimulado()) {
      console.warn(
        '⚠️  ms-notificaciones: EMAIL_USER sin definir. Los correos se SIMULAN: se ' +
          'registran como enviados y se imprimen enteros en el log, pero NO salen de la ' +
          'máquina. Es lo correcto en desarrollo y sería un fallo en producción.',
      );
    }

    app.listen(PUERTO, () => {
      console.log(`📨 ms-notificaciones escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-notificaciones: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
