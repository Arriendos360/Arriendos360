/**
 * Arranque de MS-Identidad: valida el entorno, aplica o comprueba las
 * migraciones, arranca el publicador del bus y escucha.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones, migracionesPendientes } from './database/migraciones';
import { almacen, publicador } from './eventos';
import { purgarVencidos } from './services/limites';
import { enteroDeEntorno, validarEntorno, siNoDeEntorno } from 'arriendos360-shared';

/** Cada cuanto se borran las ventanas vencidas de los limites de tasa. */
const PURGA_LIMITES_MS = 5 * 60 * 1000;

const PUERTO = enteroDeEntorno('PORT', 3011);

/**
 * Variables obligatorias. Sin `MS_NOTIFICACIONES_URL` los eventos se darían por
 * entregados sin enviar ningún correo.
 */
const OBLIGATORIAS = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'SERVICIO_JWT_SECRET',
  'MS_NOTIFICACIONES_URL',
  'MIGRACIONES_AL_ARRANCAR',
];

const iniciar = async (): Promise<void> => {
  try {
    validarEntorno('ms-identidad', OBLIGATORIAS);

    await sequelize.authenticate();
    console.log('✅ ms-identidad: conexión a PostgreSQL exitosa');

    // Con MIGRACIONES_AL_ARRANCAR=no sólo comprueba que no falte ninguna.
    if (siNoDeEntorno('MIGRACIONES_AL_ARRANCAR')) {
      const aplicadas = await aplicarMigraciones(sequelize);
      console.log(
        aplicadas.length > 0
          ? `✅ ms-identidad: migraciones aplicadas: ${aplicadas.join(', ')}`
          : '✅ ms-identidad: esquema al día, sin migraciones pendientes',
      );
    } else {
      const pendientes = await migracionesPendientes(sequelize);
      if (pendientes.length > 0) {
        throw new Error(
          `ms-identidad: MIGRACIONES_AL_ARRANCAR=no y hay migraciones pendientes: ${pendientes.join(', ')}. ` +
            'Aplícalas antes con el Job de migración (node dist/database/aplicar.js).',
        );
      }
      console.log('✅ ms-identidad: esquema al día (las migraciones las aplica el Job, no este proceso)');
    }

    // Purga periódica de las ventanas vencidas de los límites de tasa.
    setInterval(() => {
      purgarVencidos().catch((error: Error) =>
        console.error('⚠️  ms-identidad: no se pudieron purgar los límites de tasa:', error.message),
      );
    }, PURGA_LIMITES_MS).unref();

    const pendientes = await almacen.contar();
    await publicador.iniciar();
    const estado = publicador.estado();
    console.log(
      `📤 ms-identidad: publicador en marcha cada ${estado.intervaloMs / 1000}s — ` +
        `${pendientes.pendientes} evento(s) pendiente(s), ${pendientes.apartados} apartado(s).`,
    );

    if (pendientes.apartados > 0) {
      console.warn(
        `⚠️  ms-identidad: ${pendientes.apartados} evento(s) APARTADO(S) en ` +
          'identidad.eventos_salida. No se reintentan solos: hay que mirar `ultimo_error` y ' +
          'reencolarlos.',
      );
    }

    app.listen(PUERTO, () => {
      console.log(`🪪  ms-identidad escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-identidad: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
