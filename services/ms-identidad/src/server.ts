/**
 * Arranque de MS-Identidad.
 *
 * Aplica sus migraciones antes de escuchar: el esquema `identidad` es suyo y de
 * nadie mas, asi que nadie mas puede prepararlo.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones } from './database/migraciones';

const PUERTO = Number(process.env['PORT'] ?? 3011);

const iniciar = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('✅ ms-identidad: conexión a PostgreSQL exitosa');

    const aplicadas = await aplicarMigraciones(sequelize);
    console.log(
      aplicadas.length > 0
        ? `✅ ms-identidad: migraciones aplicadas: ${aplicadas.join(', ')}`
        : '✅ ms-identidad: esquema al día, sin migraciones pendientes',
    );

    app.listen(PUERTO, () => {
      console.log(`🪪  ms-identidad escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-identidad: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
