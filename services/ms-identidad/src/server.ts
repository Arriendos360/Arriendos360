/**
 * Arranque de MS-Identidad.
 *
 * Aplica sus migraciones antes de escuchar: el esquema `identidad` es suyo y de
 * nadie mas, asi que nadie mas puede prepararlo.
 *
 * ── DESDE EL PASO 7 ESTE SERVICIO ES PRODUCTOR DEL BUS ─────────────────────
 *
 * Y deja de ser cliente de SMTP, que es la otra mitad de la misma frase. Hasta aqui
 * abria una conexion de correo para el enlace de recuperacion; ahora anota
 * `RecuperacionSolicitada` y `ContrasenaTemporalEmitida` en su tabla de salida y es
 * ms-notificaciones quien decide a quien avisar. Con eso el `docs/adr/0010` queda
 * saldado: su desviacion era ese envio directo.
 *
 * El publicador arranca AQUI y no al cargar el modulo, por la misma razon que en
 * ms-contratos: un temporizador corriendo durante una suite haria que las entregas
 * ocurrieran en momentos que la prueba no controla. Las pruebas llaman a `ciclo()` a
 * mano.
 *
 * ── SIN SUSCRIPTOR CONFIGURADO, LOS EVENTOS SE DAN POR ENTREGADOS ──────────
 *
 * Es el comportamiento de `crearEntregaHttp` y es el correcto en una coreografia —el
 * productor no sabe ni tiene que saber quien escucha— pero aqui tiene una
 * consecuencia visible que conviene no descubrir en produccion: sin
 * `MS_NOTIFICACIONES_URL`, pedir recuperacion de contrasena emite el token, marca el
 * evento como entregado y NO MANDA NINGUN CORREO. No hay error en ninguna parte.
 *
 * De ahi el aviso del arranque. Es el mismo tipo de agujero silencioso que el cron
 * del motor con scale-to-zero (`docs/adr/0018`), y se trata igual: gritarlo en el log
 * es lo unico que impide que pase inadvertido.
 */

import { app } from './app';
import { sequelize } from './config/database';
import { aplicarMigraciones } from './database/migraciones';
import { almacen, publicador, suscriptoresDe } from './eventos';
import { TIPO_RECUPERACION_SOLICITADA } from 'arriendos360-shared';

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

    if (suscriptoresDe(TIPO_RECUPERACION_SOLICITADA).length === 0) {
      console.warn(
        '⚠️  ms-identidad: MS_NOTIFICACIONES_URL sin definir. Los eventos se darán por ' +
          'entregados sin que nadie los reciba, así que NO saldrá ningún correo — ni el ' +
          'enlace de recuperación de contraseña. Y no habrá ningún error que lo delate.',
      );
    }

    const pendientes = await almacen.contar();
    await publicador.iniciar();
    const estado = publicador.estado();
    console.log(
      `📤 ms-identidad: publicador en marcha cada ${estado.intervaloMs / 1000}s — ` +
        `${pendientes.pendientes} evento(s) pendiente(s), ${pendientes.apartados} apartado(s).`,
    );

    if (pendientes.apartados > 0) {
      console.warn(
        `⚠️  ms-identidad: ${pendientes.apartados} evento(s) APARTADO(S) en ` +
          'identidad.eventos_salida. No se reintentan solos: hay que mirar `ultimo_error` y ' +
          'reencolarlos.',
      );
    }

    app.listen(PUERTO, () => {
      console.log(`🪪  ms-identidad escuchando en http://localhost:${PUERTO}`);
    });
  } catch (error) {
    console.error('❌ ms-identidad: error de arranque:', error);
    process.exit(1);
  }
};

void iniciar();
