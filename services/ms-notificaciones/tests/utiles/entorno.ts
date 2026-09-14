/**
 * Utilidades comunes de las pruebas de MS-Notificaciones.
 *
 * Corren contra PostgreSQL, pero solo contra el esquema `notificaciones` de la base de
 * pruebas: `recrearEsquema()` hace `DROP SCHEMA notificaciones CASCADE`, asi que
 * `public` y los esquemas de los otros servicios quedan intactos aunque compartan
 * base. Es la convencion del paso 3 —cada servicio prueba contra su propia base— y lo
 * que permite que las seis suites del monorepo corran a la vez sin pisarse.
 *
 * ── AQUI NO SE FIRMA NINGUN TOKEN DE USUARIO, Y ES LA DIFERENCIA CON LAS OTRAS ─
 *
 * Las suites de los otros cuatro servicios firman tokens de usuario para llamar a su
 * API. Esta no firma ninguno, porque este servicio no tiene API: no esta en la costura
 * del gateway ni en la matriz RBAC, y su unica entrada es `POST /interno/eventos`. La
 * unica credencial que aparece en estas pruebas es la de servicio.
 *
 * ── Y NO SE ARRANCA NINGUN TEMPORIZADOR ─────────────────────────────────────
 *
 * Ni el enviador ni nada. `enviar()` llama a `ciclo()` a mano, que es lo que hace que
 * «todavia no se ha enviado» sea una afirmacion comprobable y no una carrera. Es la
 * misma convencion que `entregarEventos()` en las suites del gateway.
 */

import crypto from 'crypto';
import request from 'supertest';
import { cabeceraDeServicio, crearSobre, textoDeEntorno } from 'arriendos360-shared';
import type { SobreEvento, TipoEvento } from 'arriendos360-shared';

import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { recrearEsquema } from '../../src/database/migraciones';
import { Envio } from '../../src/models/Envio';
import { levantarDobleIdentidad, type DobleIdentidad } from '../dobles/identidad';

export { app, sequelize, Envio };

let identidad: DobleIdentidad | null = null;

/** Levanta el doble, lo cablea y deja el esquema del servicio limpio. */
export const prepararEntorno = async (): Promise<{ identidad: DobleIdentidad }> => {
  identidad = await levantarDobleIdentidad();

  // El cliente lee `process.env` en cada llamada, asi que basta con ponerlo.
  process.env['MS_IDENTIDAD_URL'] = identidad.url;
  // Para que el enlace del correo de recuperacion sea predecible en las pruebas.
  process.env['URL_APP'] = 'http://app.test';

  await recrearEsquema(sequelize);

  return { identidad };
};

export const cerrarEntorno = async (): Promise<void> => {
  if (identidad) {
    await identidad.cerrar();
    identidad = null;
  }
  delete process.env['MS_IDENTIDAD_URL'];
  delete process.env['URL_APP'];
  await sequelize.close();
};

export const identidadFalsa = (): DobleIdentidad => identidad as DobleIdentidad;

/** Credencial de servicio, para `POST /interno/eventos`. */
export const conServicio = (emisor = 'ms-identidad'): [string, string] => {
  const cabecera = cabeceraDeServicio({
    emisor,
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-notificaciones'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  });

  return ['Authorization', cabecera['Authorization'] as string];
};

/** Registra un usuario en el doble y devuelve su id. */
export const usuarioDe = (extra: Partial<{ nombres: string; email: string }> = {}): string => {
  const id = crypto.randomUUID();

  identidadFalsa().usuarios.set(id, {
    id,
    nombres: 'Nom',
    apellidos: 'Bre',
    email: `${id}@test.com`,
    ...extra,
  });

  return id;
};

/**
 * Entrega un evento por la MISMA ruta que usa el transporte real.
 *
 * ── NADA DE LLAMAR AL MANEJADOR A MANO ─────────────────────────────────────
 *
 * Se hace un POST de verdad a `/interno/eventos`, con credencial de servicio, porque
 * eso ejercita las tres cosas que importan y que un `manejadores[tipo]()` directo no
 * tocaria: que la ruta exija credencial, que el sobre se valide al entrar, y que la
 * idempotencia se aplique donde de verdad esta.
 *
 * Devolver el sobre permite REENTREGARLO: pasarle el MISMO `id_evento` dos veces es
 * como se comprueba que no sale un segundo correo, que es la garantia central de este
 * servicio.
 */
export const entregarEvento = async <T extends TipoEvento>(
  tipo: T,
  payload: Parameters<typeof crearSobre<T>>[1],
  sobreExistente?: SobreEvento<T>,
): Promise<{ respuesta: request.Response; sobre: SobreEvento<T> }> => {
  const sobre = sobreExistente ?? crearSobre(tipo, payload);

  const respuesta = await request(app)
    .post('/interno/eventos')
    .set(...conServicio())
    .send(sobre);

  return { respuesta, sobre };
};

/** Los envios que dejo un evento, por orden de redaccion. */
export const enviosDe = (idEvento: string): Promise<Envio[]> =>
  Envio.findAll({ where: { id_evento: idEvento }, order: [['registrado_en', 'ASC']] });

/** Todos los envios de la bitacora. */
export const todosLosEnvios = (): Promise<Envio[]> =>
  Envio.findAll({ order: [['registrado_en', 'ASC']] });
