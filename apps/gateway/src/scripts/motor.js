/**
 * Disparo manual del motor financiero.
 *
 *   npm run motor --workspace=apps/gateway
 *   docker exec arriendos360_api npm run motor
 *
 * Sustituye a `POST /api/admin/ejecutar-motor`, que se eliminó. Aquel endpoint
 * tenía dos problemas. El de fondo: el motor pertenece a ms-financiero, no al
 * gateway, así que exponerlo como ruta de la API creaba una dependencia que el
 * paso 6 tendría que deshacer. El inmediato: importaba `esPropietario` pero no
 * lo aplicaba, de modo que cualquier usuario autenticado podía lanzar el proceso
 * que genera cuentas de cobro y marca morosos.
 *
 * Como script de terminal el motor sigue siendo demostrable sin esperar al cron
 * de medianoche, que es para lo que se usaba de verdad, y deja de ser superficie
 * de ataque.
 *
 * `procesarContratos` y `procesarPagos` no se tocan: son los mismos que ejecuta
 * la tarea programada.
 */

const { sequelize } = require('../config/database');
const { procesarContratos, procesarPagos } = require('../services/financialEngine');

const ejecutar = async () => {
    console.log('⚡ Motor financiero: ejecución manual');

    await sequelize.authenticate();

    console.log('   → generando cuentas de cobro pendientes...');
    await procesarContratos();

    console.log('   → revisando vencimientos y mora...');
    await procesarPagos();

    console.log('✅ Motor financiero ejecutado.');
};

ejecutar()
    .then(() => sequelize.close())
    .catch(async (error) => {
        console.error('❌ Error al ejecutar el motor financiero:', error);
        await sequelize.close();
        process.exit(1);
    });
