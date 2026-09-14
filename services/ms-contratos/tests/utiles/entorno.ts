/**
 * Utilidades comunes de las pruebas de MS-Contratos.
 *
 * Corren contra PostgreSQL, pero solo contra el esquema `contratos` de la base
 * de pruebas: `recrearEsquema()` hace `DROP SCHEMA contratos CASCADE`, asi que
 * las tablas del gateway en `public` y las de los otros servicios quedan
 * intactas aunque compartan base.
 *
 * Los tokens se FIRMAN aqui en vez de pedirselos a ms-identidad. Es la unica
 * excepcion al doble, y tiene motivo: el token es un dato, no una interaccion.
 * Este servicio nunca llama a ms-identidad para autenticar —verifica la firma en
 * local, que es justamente la decision del Capitulo 2— asi que no hay ninguna
 * conversacion que un doble pudiera representar. Lo que si pasa por los dobles
 * son las llamadas de red de verdad: la lista de revocados, la pertenencia de
 * cada inmueble y los datos del inquilino.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { cabeceraDeServicio, textoDeEntorno } from 'arriendos360-shared';

import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { recrearEsquema } from '../../src/database/migraciones';
import { AlmacenamientoDisco, usarAlmacenamiento } from '../../src/services/almacenamiento';
import {
  levantarDobleIdentidad,
  levantarDobleInmuebles,
  type DobleIdentidad,
  type DobleInmuebles,
} from '../dobles/servicios';

export { app, sequelize };

let inmuebles: DobleInmuebles | null = null;
let identidad: DobleIdentidad | null = null;

/**
 * Levanta los dobles, los cablea y deja el esquema del servicio limpio.
 *
 * El almacenamiento se apunta a un directorio temporal por suite: las pruebas de
 * anexos escriben archivos de verdad —es una implementacion, no un doble— y no
 * pueden dejarlos en el arbol del repositorio.
 */
export const prepararEntorno = async (): Promise<{
  inmuebles: DobleInmuebles;
  identidad: DobleIdentidad;
}> => {
  inmuebles = await levantarDobleInmuebles();
  identidad = await levantarDobleIdentidad();

  process.env['MS_INMUEBLES_URL'] = inmuebles.url;
  process.env['MS_IDENTIDAD_URL'] = identidad.url;

  usarAlmacenamiento(
    new AlmacenamientoDisco(`${textoDeEntorno('TEMP', '/tmp')}/ms-contratos-pruebas`),
  );

  await recrearEsquema(sequelize);

  return { inmuebles, identidad };
};

export const cerrarEntorno = async (): Promise<void> => {
  if (inmuebles) {
    await inmuebles.cerrar();
    inmuebles = null;
  }
  if (identidad) {
    await identidad.cerrar();
    identidad = null;
  }
  delete process.env['MS_INMUEBLES_URL'];
  delete process.env['MS_IDENTIDAD_URL'];
  await sequelize.close();
};

export const inmueblesFalso = (): DobleInmuebles => inmuebles as DobleInmuebles;
export const identidadFalsa = (): DobleIdentidad => identidad as DobleIdentidad;

export interface Usuario {
  sub: string;
  token: string;
  jti: string;
}

/** Firma un token con la forma que emite ms-identidad. */
export const firmarToken = (
  opciones: { sub?: string; roles?: string[]; jti?: string; iat?: number } = {},
): Usuario => {
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
export const conToken = (token: string): [string, string] => [
  'Authorization',
  `Bearer ${token}`,
];

/** Credencial de servicio, para los endpoints `/interno`. */
export const conServicio = (emisor = 'gateway'): [string, string] => {
  const cabecera = cabeceraDeServicio({
    emisor,
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-contratos'),
    secreto: process.env['SERVICIO_JWT_SECRET'],
  });

  return ['Authorization', cabecera['Authorization'] as string];
};

/** Registra un inmueble en el doble y devuelve su id. */
export const inmuebleDe = (idPropietario: string, direccion = 'Calle 123 #45-67'): string => {
  const id = crypto.randomUUID();
  inmueblesFalso().inmuebles.set(id, {
    id_inmueble: id,
    id_propietario: idPropietario,
    direccion,
    municipio: 'Bogotá D.C.',
    tipo: 'apartamento',
    estado: 'disponible',
  });
  return id;
};

/** Registra un inquilino en el doble de identidad y devuelve su id. */
export const inquilinoDe = (nombres = 'Inq', apellidos = 'Uilino'): string => {
  const id = crypto.randomUUID();
  identidadFalsa().usuarios.set(id, {
    id,
    nombres,
    apellidos,
    email: `${id}@test.com`,
    documento: id.slice(0, 8),
    telefono: '3000000000',
    roles: ['INQUILINO'],
  });
  return id;
};

/** Cuerpo valido de alta, para no repetirlo en cada prueba. */
export const contratoValido = (
  idInmueble: string,
  idInquilino: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id_inmueble: idInmueble,
  id_inquilino: idInquilino,
  inicio: '2026-01-01',
  fin: '2026-12-31',
  canon: 1500000,
  ...extra,
});

/** Crea un contrato por la API y devuelve su id. */
export const crearContrato = async (
  token: string,
  idInmueble: string,
  idInquilino: string,
  extra: Record<string, unknown> = {},
): Promise<{ respuesta: request.Response; id: string }> => {
  const respuesta = await request(app)
    .post('/api/contratos')
    .set(...conToken(token))
    .send(contratoValido(idInmueble, idInquilino, extra));

  return { respuesta, id: respuesta.body.contrato?.id_contrato };
};
