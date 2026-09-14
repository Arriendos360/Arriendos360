/** Aplica las migraciones a mano: `npm run migrate --workspace=services/ms-notificaciones`. */

import { sequelize } from '../config/database';
import { aplicarMigraciones } from './migraciones';

aplicarMigraciones(sequelize)
  .then((aplicadas) => {
    console.log(aplicadas.length > 0 ? aplicadas.join(', ') : 'sin migraciones pendientes');
    return sequelize.close();
  })
  .catch(async (error) => {
    console.error('❌ Error al migrar:', error);
    await sequelize.close();
    process.exit(1);
  });
