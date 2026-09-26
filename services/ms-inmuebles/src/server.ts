/**
 * Arranque de MS-Inmuebles: valida el entorno, aplica o comprueba las
 * migraciones, arranca la caché de revocación y escucha.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones, migracionesPendientes } from './database/migraciones';
import { cache } from './seguridad/cache';
import { enteroDeEntorno, validarEntorno, siNoDeEntorno } from 'arriendos360-shared';

const PUERTO = enteroDeEntorno('PORT', 3012);

/** Variables obligatorias. Sin `MS_IDENTIDAD_URL` no se comprobaría la revocación. */
const OBLIGATORIAS = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'SERVICIO_JWT_SECRET',
  'MS_IDENTIDAD_URL',
  'MIGRACIONES_AL_ARRANCAR',
];

const iniciar = async (): Promise<void> => {
  try {
    validarEntorno('ms-inmuebles', OBLIGATORIAS);

    await sequelize.authenticate();
    console.log('✅ ms-inmuebles: conexión a PostgreSQL exitosa');

    // Con MIGRACIONES_AL_ARRANCAR=no sólo comprueba que no falte ninguna.
    if (siNoDeEntorno('MIGRACIONES_AL_ARRANCAR')) {
      const aplicadas = await aplicarMigraciones(sequelize);
      console.log(
        aplicadas.length > 0
          ? `✅ ms-inmuebles: migraciones aplicadas: ${aplicadas.join(', ')}`
          : '✅ ms-inmuebles: esquema al día, sin migraciones pendientes',
      );
    } else {
      const pendientes = await migracionesPendientes(sequelize);
      if (pendientes.length > 0) {
        throw new Error(
          `ms-inmuebles: MIGRACIONES_AL_ARRANCAR=no y hay migraciones pendientes: ${pendientes.join(', ')}. ` +
            'Aplícalas antes con el Job de migración (node dist/database/aplicar.js).',
        );
      }
      console.log('✅ ms-inmuebles: esquema al día (las migraciones las aplica el Job, no este proceso)');
    }

    await cache.iniciar();
    const estado = cache.estado();
    console.log(
      `🔑 ms-inmuebles: caché de invalidación con ${estado.vigentes} tokens revocados y ` +
        `${estado.sesionesInvalidadas} sesiones caídas, refresco cada ${
          estado.intervaloMs / 1000
        }s` + `${estado.ultimoError ? ` — ÚLTIMO FALLO: ${estado.ultimoError}` : ''}`,
    );

    app.listen(PUERTO, () => {
      console.log(`🏠 ms-inmuebles escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-inmuebles: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
