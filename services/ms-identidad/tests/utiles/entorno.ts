/**
 * Utilidades comunes de las pruebas de MS-Identidad.
 *
 * Corren contra PostgreSQL, pero sólo contra el esquema `identidad` de la base
 * de pruebas: `recrearEsquema()` hace `DROP SCHEMA identidad CASCADE`, así que
 * las tablas del gateway en `public` quedan intactas aunque compartan base.
 */

import request from 'supertest';
import { cabeceraDeServicio } from 'arriendos360-shared';

import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { recrearEsquema } from '../../src/database/migraciones';

export const CONTRASENA_POR_DEFECTO = 'pass123';

export { app, sequelize };

/** Deja el esquema del servicio vacío y recién migrado. */
export const recrearBase = (): Promise<string[]> => recrearEsquema(sequelize);

export const cerrarBase = (): Promise<void> => sequelize.close();

export interface Sesion {
  registro: request.Response;
  login: request.Response;
  token: string;
  id: string;
  email: string;
  documento: string;
}

/** Registra un propietario y devuelve su token y su UUID. */
export const registrarPropietario = async (datos: Record<string, string>): Promise<Sesion> => {
  const cuerpo: Record<string, string> = {
    contrasena: CONTRASENA_POR_DEFECTO,
    telefono: '3000000000',
    ...datos,
  };

  const registro = await request(app).post('/api/auth/registro').send(cuerpo);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: cuerpo['email'], contrasena: cuerpo['contrasena'] });

  return {
    registro,
    login,
    token: login.body.token,
    id: login.body.usuario?.id,
    email: cuerpo['email']!,
    documento: cuerpo['documento']!,
  };
};

/** Da de alta un inquilino usando el token de un propietario. */
export const crearInquilino = async (
  tokenPropietario: string,
  datos: Record<string, string>,
): Promise<{ respuesta: request.Response; id: string }> => {
  const cuerpo: Record<string, string> = {
    contrasena: CONTRASENA_POR_DEFECTO,
    telefono: '3000000001',
    ...datos,
  };

  const respuesta = await request(app)
    .post('/api/usuarios/inquilinos')
    .set('Authorization', `Bearer ${tokenPropietario}`)
    .send(cuerpo);

  return { respuesta, id: respuesta.body.usuario?.id };
};

export const iniciarSesion = (
  email: string,
  contrasena: string = CONTRASENA_POR_DEFECTO,
): request.Test => request(app).post('/api/auth/login').send({ email, contrasena });

/** Cabecera de autorización lista para `.set(...)`. */
export const conToken = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

/**
 * Credencial de servicio, para los endpoints `/interno`.
 *
 * Los llama otro servicio, no una persona, así que no llevan token de usuario
 * sino uno de servicio firmado con `SERVICIO_JWT_SECRET`.
 */
export const conServicio = (emisor = 'gateway'): [string, string] => {
  const cabecera = cabeceraDeServicio({
    emisor,
    destinatario: process.env['SERVICIO_NOMBRE'] ?? 'ms-identidad',
    secreto: process.env['SERVICIO_JWT_SECRET'],
  });

  return ['Authorization', cabecera['Authorization'] as string];
};
