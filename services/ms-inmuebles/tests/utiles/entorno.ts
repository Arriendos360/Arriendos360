/**
 * Utilidades comunes de las pruebas de MS-Inmuebles.
 *
 * Corren contra PostgreSQL, pero solo contra el esquema `inmuebles` de la base
 * de pruebas: `recrearEsquema()` hace `DROP SCHEMA inmuebles CASCADE`, asi que
 * las tablas del gateway en `public` y las de identidad quedan intactas aunque
 * compartan base.
 *
 * Los tokens se FIRMAN aqui en vez de pedirselos a ms-identidad. Es la unica
 * excepcion al doble, y tiene motivo: el token es un dato, no una interaccion.
 * Este servicio nunca llama a ms-identidad para autenticar —verifica la firma en
 * local, que es justamente la decision del Capitulo 2— asi que no hay ninguna
 * conversacion que un doble pudiera representar. Lo que si pasa por el doble es
 * la lista de revocados, que si es una llamada de red.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { cabeceraDeServicio, textoDeEntorno } from 'arriendos360-shared';

import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { recrearEsquema } from '../../src/database/migraciones';

export { app, sequelize };

/** Deja el esquema del servicio vacio y recien migrado. */
export const recrearBase = (): Promise<string[]> => recrearEsquema(sequelize);

export const cerrarBase = (): Promise<void> => sequelize.close();

export interface Usuario {
  sub: string;
  token: string;
  jti: string;
}

/**
 * Firma un token con la forma que emite ms-identidad.
 *
 * `iat` explicito para poder fabricar un token ANTERIOR a un cambio de
 * contrasena, que es como se prueba la invalidacion en bloque.
 */
export const firmarToken = (opciones: {
  sub?: string;
  roles?: string[];
  jti?: string;
  iat?: number;
} = {}): Usuario => {
  const sub = opciones.sub ?? crypto.randomUUID();
  const jti = opciones.jti ?? crypto.randomUUID();
  const iat = opciones.iat ?? Math.floor(Date.now() / 1000);

  const token = jwt.sign(
    {
      sub,
      email: `${sub}@test.com`,
      roles: opciones.roles ?? ['PROPIETARIO'],
      jti,
      iat,
    },
    process.env['JWT_SECRET'] as jwt.Secret,
    { expiresIn: 3600 },
  );

  return { sub, token, jti };
};

/** Un propietario cualquiera, con token listo. */
export const propietario = (): Usuario => firmarToken({ roles: ['PROPIETARIO'] });

/** Un inquilino cualquiera: sirve para comprobar que la Capa 3 lo rechaza. */
export const inquilino = (): Usuario => firmarToken({ roles: ['INQUILINO'] });

/** Cabecera de autorizacion lista para `.set(...)`. */
export const conToken = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

/** Credencial de servicio, para los endpoints `/interno`. */
export const conServicio = (emisor = 'gateway'): [string, string] => {
  const cabecera = cabeceraDeServicio({
    emisor,
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-inmuebles'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  });

  return ['Authorization', cabecera['Authorization'] as string];
};

/** Cuerpo valido de alta, para no repetirlo en cada prueba. */
export const inmuebleValido = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  direccion: 'Calle 123 #45-67',
  tipo: 'apartamento',
  municipio: 'Bogotá D.C.',
  barrio: 'Chapinero',
  ...extra,
});

/** Crea un inmueble por la API y devuelve su id. */
export const crearInmueble = async (
  token: string,
  extra: Record<string, unknown> = {},
): Promise<{ respuesta: request.Response; id: string }> => {
  const respuesta = await request(app)
    .post('/api/inmuebles')
    .set(...conToken(token))
    .send(inmuebleValido(extra));

  return { respuesta, id: respuesta.body.inmueble?.id_inmueble };
};
