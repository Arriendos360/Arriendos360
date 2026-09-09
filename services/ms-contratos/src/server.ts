/**
 * Arranque de MS-Contratos.
 *
 * Aplica sus migraciones antes de escuchar: el esquema `contratos` es suyo y de
 * nadie mas, asi que nadie mas puede prepararlo. Y ademas es lo que hace segura
 * la mudanza — el healthcheck de Compose solo responde despues de migrar, y el
 * gateway espera a ese healthcheck antes de aplicar `database/dominio/007`, que
 * es la que retira `public.contratos`.
 *
 * ARRANCA EL PUBLICADOR, que es lo que le hace ser el productor de verdad y no
 * solo el dueño de la tabla. Mientras esto no corra, los eventos se acumulan en
 * la bandeja y el estado de los inmuebles no converge.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones } from './database/migraciones';
import { publicador } from './eventos';
import { cache, hayFuenteDeRevocacion } from './seguridad/cache';
import { almacenamiento } from './services/almacenamiento';

const PUERTO = Number(process.env['PORT'] ?? 3013);

const iniciar = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('✅ ms-contratos: conexión a PostgreSQL exitosa');

    const aplicadas = await aplicarMigraciones(sequelize);
    console.log(
      aplicadas.length > 0
        ? `✅ ms-contratos: migraciones aplicadas: ${aplicadas.join(', ')}`
        : '✅ ms-contratos: esquema al día, sin migraciones pendientes',
    );

    console.log(`📎 ms-contratos: anexos en ${almacenamiento().describir()}`);

    if (hayFuenteDeRevocacion()) {
      await cache.iniciar();
      const estado = cache.estado();
      console.log(
        `🔑 ms-contratos: caché de invalidación con ${estado.vigentes} tokens revocados y ` +
          `${estado.sesionesInvalidadas} sesiones caídas, refresco cada ${
            estado.intervaloMs / 1000
          }s` + `${estado.ultimoError ? ` — ÚLTIMO FALLO: ${estado.ultimoError}` : ''}`,
      );
    } else {
      // No se aborta el arranque, pero tampoco se calla: sin fuente, un token de
      // una sesion cerrada entra. Es aceptable en una prueba aislada y no lo es
      // en ningun despliegue.
      console.warn(
        '⚠️  ms-contratos: MS_IDENTIDAD_URL sin definir. NO se comprobará la revocación de tokens.',
      );
    }

    // El publicador del bus. Barre la tabla de salida y entrega lo pendiente.
    await publicador.iniciar();
    const salida = publicador.estado();
    console.log(
      `📤 ms-contratos: publicador de eventos cada ${salida.intervaloMs / 1000}s, ` +
        `hasta ${salida.maxIntentos} intentos por evento antes de apartarlo`,
    );

    app.listen(PUERTO, () => {
      console.log(`📄 ms-contratos escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-contratos: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
