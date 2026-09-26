/**
 * Arranque de MS-Contratos: valida el entorno, aplica o comprueba las
 * migraciones, arranca la caché de revocación y el publicador del bus, y escucha.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones, migracionesPendientes } from './database/migraciones';
import { publicador } from './eventos';
import { cache } from './seguridad/cache';
import { almacenamiento } from './services/almacenamiento';
import { enteroDeEntorno, validarEntorno, siNoDeEntorno } from 'arriendos360-shared';

const PUERTO = enteroDeEntorno('PORT', 3013);

/**
 * Variables obligatorias. Sin las `MS_*_URL` no se comprobaría la revocación ni la
 * pertenencia, y `ContratoFormalizado` se daría por entregado sin facturar.
 */
const OBLIGATORIAS = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'SERVICIO_JWT_SECRET',
  'MS_IDENTIDAD_URL',
  'MS_INMUEBLES_URL',
  'MS_FINANCIERO_URL',
  'MIGRACIONES_AL_ARRANCAR',
];

const iniciar = async (): Promise<void> => {
  try {
    validarEntorno('ms-contratos', OBLIGATORIAS);

    await sequelize.authenticate();
    console.log('✅ ms-contratos: conexión a PostgreSQL exitosa');

    // Con MIGRACIONES_AL_ARRANCAR=no sólo comprueba que no falte ninguna.
    if (siNoDeEntorno('MIGRACIONES_AL_ARRANCAR')) {
      const aplicadas = await aplicarMigraciones(sequelize);
      console.log(
        aplicadas.length > 0
          ? `✅ ms-contratos: migraciones aplicadas: ${aplicadas.join(', ')}`
          : '✅ ms-contratos: esquema al día, sin migraciones pendientes',
      );
    } else {
      const pendientes = await migracionesPendientes(sequelize);
      if (pendientes.length > 0) {
        throw new Error(
          `ms-contratos: MIGRACIONES_AL_ARRANCAR=no y hay migraciones pendientes: ${pendientes.join(', ')}. ` +
            'Aplícalas antes con el Job de migración (node dist/database/aplicar.js).',
        );
      }
      console.log('✅ ms-contratos: esquema al día (las migraciones las aplica el Job, no este proceso)');
    }

    console.log(`📎 ms-contratos: anexos en ${almacenamiento().describir()}`);

    await cache.iniciar();
    const estado = cache.estado();
    console.log(
      `🔑 ms-contratos: caché de invalidación con ${estado.vigentes} tokens revocados y ` +
        `${estado.sesionesInvalidadas} sesiones caídas, refresco cada ${
          estado.intervaloMs / 1000
        }s` + `${estado.ultimoError ? ` — ÚLTIMO FALLO: ${estado.ultimoError}` : ''}`,
    );

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
