/**
 * Arranque de MS-Notificaciones.
 *
 * Aplica sus migraciones antes de escuchar: el esquema `notificaciones` es suyo y de
 * nadie mas, asi que nadie mas puede prepararlo. A diferencia de las cuatro
 * extracciones anteriores, aqui no hay ninguna mudanza que coreografiar — este
 * servicio no le quita una tabla a nadie, sus dos tablas son nuevas y nacen vacias.
 *
 * ── ES CONSUMIDOR, Y NO ES PRODUCTOR ───────────────────────────────────────
 *
 * No tiene tabla de salida ni publicador: no emite ningun evento. Es el final de las
 * cadenas, no un eslabon intermedio, y esa es la forma que le toca a un subdominio
 * Generico — reacciona y no anuncia.
 *
 * Lo que si arranca es el ENVIADOR, que no es lo mismo que un publicador aunque se
 * le parezca: barre `notificaciones.envios` y manda los correos que los manejadores
 * dejaron redactados. Ver la cabecera de `services/enviador.ts`.
 *
 * ── LO QUE SE COMPRUEBA EN EL ARRANQUE, Y POR QUE ESTAS TRES COSAS ─────────
 *
 * 1. `MS_IDENTIDAD_URL`. Sin ella este servicio NO PUEDE NOTIFICAR A NADIE, porque
 *    los eventos no llevan direcciones de correo y el destinatario se resuelve
 *    preguntando. Es OBLIGATORIA y sin ella el servicio no arranca. Antes arrancaba,
 *    aceptaba eventos, devolvia 500 y lo avisaba en el log — y un sistema que acepta
 *    eventos y no manda nada es indistinguible de uno que funciona si nadie mira.
 *
 * 2. Cuantos eventos lleva procesados. Es el numero que dice si el bus esta
 *    llegando.
 *
 * 3. Cuantos envios hay en `enviando` y en `apartado`. Son los dos estados que NADIE
 *    va a resolver solo: el primero son los correos que se quedaron en el aire
 *    cuando el proceso murio y que este servicio NO reintenta a proposito, el
 *    segundo los que agotaron sus intentos. Que salgan en el log de arranque es lo
 *    que hace que un problema de correo se vea sin ir a buscarlo.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones, migracionesPendientes } from './database/migraciones';
import { consumidor } from './eventos';
import { esSimulado } from './config/mailer';
import { contarEnvios, enviador } from './services/enviador';
import { enteroDeEntorno, validarEntorno, siNoDeEntorno } from 'arriendos360-shared';

const PUERTO = enteroDeEntorno('PORT', 3015);

/**
 * Lo que no tiene defecto razonable. `EMAIL_USER` NO esta: sin ella los correos se
 * simulan, que es lo correcto en desarrollo, y el arranque lo avisa mas abajo.
 */
const OBLIGATORIAS = [
  'DB_PASSWORD',
  'SERVICIO_JWT_SECRET',
  'MS_IDENTIDAD_URL',
  'MIGRACIONES_AL_ARRANCAR',
];

const iniciar = async (): Promise<void> => {
  try {
    validarEntorno('ms-notificaciones', OBLIGATORIAS);

    await sequelize.authenticate();
    console.log('✅ ms-notificaciones: conexión a PostgreSQL exitosa');

    // En Compose migra el propio servicio; en Azure lo hace un Job ANTES de publicar la
    // revision y el servicio solo comprueba, para que varias replicas no migren a la vez.
    // Ver docs/adr/0022.
    if (siNoDeEntorno('MIGRACIONES_AL_ARRANCAR')) {
      const aplicadas = await aplicarMigraciones(sequelize);
      console.log(
        aplicadas.length > 0
          ? `✅ ms-notificaciones: migraciones aplicadas: ${aplicadas.join(', ')}`
          : '✅ ms-notificaciones: esquema al día, sin migraciones pendientes',
      );
    } else {
      const pendientes = await migracionesPendientes(sequelize);
      if (pendientes.length > 0) {
        throw new Error(
          `ms-notificaciones: MIGRACIONES_AL_ARRANCAR=no y hay migraciones pendientes: ${pendientes.join(', ')}. ` +
            'Aplícalas antes con el Job de migración (node dist/database/aplicar.js).',
        );
      }
      console.log('✅ ms-notificaciones: esquema al día (las migraciones las aplica el Job, no este proceso)');
    }

    // El consumidor no arranca nada: es un manejador HTTP. Se cuenta lo que lleva
    // procesado porque es el numero que dice si el bus esta llegando.
    console.log(
      `📥 ms-notificaciones: consumidor del bus con ${await consumidor.contar()} eventos ` +
        'procesados. Escucha 5 tipos en POST /interno/eventos.',
    );

    const envios = await contarEnvios();
    console.log(
      `✉️  ms-notificaciones: bitácora con ${envios.enviados} enviados y ` +
        `${envios.pendientes} pendientes.`,
    );

    // Los dos estados que nadie resuelve solo. Se avisan aparte y en alto.
    if (envios.enviando > 0 || envios.apartados > 0) {
      console.warn(
        `⚠️  ms-notificaciones: ${envios.enviando} envío(s) quedaron en «enviando» y ` +
          `${envios.apartados} están apartados. NINGUNO se va a reintentar solo — los ` +
          'primeros porque no se sabe si salieron y repetir un correo es peor que no ' +
          'mandarlo, los segundos porque agotaron sus intentos. Consulta ' +
          'notificaciones.envios.',
      );
    }

    await enviador.iniciar();
    const estado = enviador.estado();
    console.log(
      `🚀 ms-notificaciones: enviador en marcha, barrido cada ${estado.intervaloMs / 1000}s, ` +
        `${estado.maxIntentos} intentos por envío.`,
    );

    // Se dice en el arranque y no sólo en cada envío, porque es una propiedad del
    // despliegue: sin EMAIL_USER el mensaje se acepta y se registra como enviado pero no
    // sale de la máquina. Callarlo dejaría un sistema que parece estar avisando a gente.
    if (esSimulado()) {
      console.warn(
        '⚠️  ms-notificaciones: EMAIL_USER sin definir. Los correos se SIMULAN: se ' +
          'registran como enviados y se imprimen enteros en el log, pero NO salen de la ' +
          'máquina. Es lo correcto en desarrollo y sería un fallo en producción.',
      );
    }

    app.listen(PUERTO, () => {
      console.log(`📨 ms-notificaciones escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-notificaciones: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
