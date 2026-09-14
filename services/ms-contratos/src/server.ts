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
import { aplicarMigraciones, migracionesPendientes } from './database/migraciones';
import { publicador } from './eventos';
import { cache } from './seguridad/cache';
import { almacenamiento } from './services/almacenamiento';
import { enteroDeEntorno, validarEntorno, siNoDeEntorno } from 'arriendos360-shared';

const PUERTO = enteroDeEntorno('PORT', 3013);

/**
 * Lo que no tiene defecto razonable. Sin `MS_IDENTIDAD_URL` un token de una sesion
 * cerrada entraria; sin `MS_INMUEBLES_URL` no hay pertenencia; sin `MS_FINANCIERO_URL`
 * `ContratoFormalizado` se daria por entregado y ningun contrato facturaria. Antes el
 * primer caso arrancaba con un aviso y los otros dos ni eso.
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

    // En Compose migra el propio servicio; en Azure lo hace un Job ANTES de publicar la
    // revision y el servicio solo comprueba, para que varias replicas no migren a la vez.
    // Ver docs/adr/0022.
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
