/**
 * Arranque de MS-Financiero: valida el entorno, aplica o comprueba las
 * migraciones, arranca la caché de revocación y el publicador del bus, programa
 * el motor si `MOTOR_PROGRAMACION=cron` y escucha.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones, migracionesPendientes } from './database/migraciones';
import { enteroDeEntorno, validarEntorno, siNoDeEntorno } from 'arriendos360-shared';

import { cache } from './seguridad/cache';
import { consumidor } from './eventos';
import { almacen, publicador } from './eventos/salida';
import { iniciarMotorFinanciero } from './services/motor';

const PUERTO = enteroDeEntorno('PORT', 3014);

/**
 * Variables obligatorias. Sin `MS_NOTIFICACIONES_URL` los avisos se darían por
 * entregados sin enviar ningún correo.
 */
const OBLIGATORIAS = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'SERVICIO_JWT_SECRET',
  'MS_CONTRATOS_URL',
  'MS_IDENTIDAD_URL',
  'MS_NOTIFICACIONES_URL',
  // `cron` o `trabajo`; el valor lo valida `iniciarMotorFinanciero()`.
  'MOTOR_PROGRAMACION',
  'MIGRACIONES_AL_ARRANCAR',
];

const iniciar = async (): Promise<void> => {
  try {
    validarEntorno('ms-financiero', OBLIGATORIAS);

    await sequelize.authenticate();
    console.log('✅ ms-financiero: conexión a PostgreSQL exitosa');

    // Con MIGRACIONES_AL_ARRANCAR=no sólo comprueba que no falte ninguna.
    if (siNoDeEntorno('MIGRACIONES_AL_ARRANCAR')) {
      const aplicadas = await aplicarMigraciones(sequelize);
      console.log(
        aplicadas.length > 0
          ? `✅ ms-financiero: migraciones aplicadas: ${aplicadas.join(', ')}`
          : '✅ ms-financiero: esquema al día, sin migraciones pendientes',
      );
    } else {
      const pendientes = await migracionesPendientes(sequelize);
      if (pendientes.length > 0) {
        throw new Error(
          `ms-financiero: MIGRACIONES_AL_ARRANCAR=no y hay migraciones pendientes: ${pendientes.join(', ')}. ` +
            'Aplícalas antes con el Job de migración (node dist/database/aplicar.js).',
        );
      }
      console.log('✅ ms-financiero: esquema al día (las migraciones las aplica el Job, no este proceso)');
    }

    await cache.iniciar();
    const estado = cache.estado();
    console.log(
      `🔑 ms-financiero: caché de invalidación con ${estado.vigentes} tokens revocados y ` +
        `${estado.sesionesInvalidadas} sesiones caídas, refresco cada ${
          estado.intervaloMs / 1000
        }s` + `${estado.ultimoError ? ` — ÚLTIMO FALLO: ${estado.ultimoError}` : ''}`,
    );

    // El consumidor es un manejador HTTP: sólo se informa lo procesado.
    console.log(
      `📥 ms-financiero: consumidor del bus con ${await consumidor.contar()} eventos procesados. ` +
        'Escucha ContratoFormalizado en POST /interno/eventos.',
    );

    // Publicador de sus propios eventos.
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
