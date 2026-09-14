/**
 * Arranque de MS-Inmuebles.
 *
 * Aplica sus migraciones antes de escuchar: el esquema `inmuebles` es suyo y de
 * nadie mas, asi que nadie mas puede prepararlo.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones, migracionesPendientes } from './database/migraciones';
import { cache } from './seguridad/cache';
import { enteroDeEntorno, validarEntorno, siNoDeEntorno } from 'arriendos360-shared';

const PUERTO = enteroDeEntorno('PORT', 3012);

/**
 * Lo que no tiene defecto razonable. Sin `MS_IDENTIDAD_URL` el servicio arrancaba con
 * un aviso y dejaba entrar tokens de sesiones cerradas.
 */
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

    // En Compose migra el propio servicio; en Azure lo hace un Job ANTES de publicar la
    // revision y el servicio solo comprueba, para que varias replicas no migren a la vez.
    // Ver docs/adr/0022.
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
