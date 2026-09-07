/**
 * Arranque de MS-Inmuebles.
 *
 * Aplica sus migraciones antes de escuchar: el esquema `inmuebles` es suyo y de
 * nadie mas, asi que nadie mas puede prepararlo.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones } from './database/migraciones';
import { cache, hayFuenteDeRevocacion } from './seguridad/cache';

const PUERTO = Number(process.env['PORT'] ?? 3012);

const iniciar = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('✅ ms-inmuebles: conexión a PostgreSQL exitosa');

    const aplicadas = await aplicarMigraciones(sequelize);
    console.log(
      aplicadas.length > 0
        ? `✅ ms-inmuebles: migraciones aplicadas: ${aplicadas.join(', ')}`
        : '✅ ms-inmuebles: esquema al día, sin migraciones pendientes',
    );

    if (hayFuenteDeRevocacion()) {
      await cache.iniciar();
      const estado = cache.estado();
      console.log(
        `🔑 ms-inmuebles: caché de invalidación con ${estado.vigentes} tokens revocados y ` +
          `${estado.sesionesInvalidadas} sesiones caídas, refresco cada ${
            estado.intervaloMs / 1000
          }s` + `${estado.ultimoError ? ` — ÚLTIMO FALLO: ${estado.ultimoError}` : ''}`,
      );
    } else {
      // No se aborta el arranque, pero tampoco se calla: sin fuente, un token de
      // una sesion cerrada entra. Es aceptable en una prueba aislada y no lo es
      // en ningun despliegue.
      console.warn(
        '⚠️  ms-inmuebles: MS_IDENTIDAD_URL sin definir. NO se comprobará la revocación de tokens.',
      );
    }

    app.listen(PUERTO, () => {
      console.log(`🏠 ms-inmuebles escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-inmuebles: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
