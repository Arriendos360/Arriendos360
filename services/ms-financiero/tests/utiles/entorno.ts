/**
 * Utilidades comunes de las pruebas de MS-Financiero.
 *
 * Corren contra PostgreSQL, pero solo contra el esquema `financiero` de la base
 * de pruebas: `recrearEsquema()` hace `DROP SCHEMA financiero CASCADE`, asi que
 * `public` y los esquemas de los otros servicios quedan intactos aunque
 * compartan base. Es la convencion del paso 3 —cada servicio prueba contra su
 * propia base— y lo que permite que las cinco suites del monorepo corran a la
 * vez sin pisarse.
 *
 * Los tokens se FIRMAN aqui en vez de pedirselos a ms-identidad. Es la unica
 * excepcion al doble, y tiene motivo: el token es un dato, no una interaccion.
 * Este servicio nunca llama a ms-identidad para autenticar —verifica la firma en
 * local, que es la decision del Capitulo 2— asi que no hay ninguna conversacion
 * que un doble pudiera representar. Lo que si pasa por los dobles son las
 * llamadas de red de verdad: la pertenencia de cada contrato, los datos del
 * inquilino y del propietario, y la lista de revocados.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { cabeceraDeServicio, crearSobre } from 'arriendos360-shared';
import type { SobreEvento, TipoEvento } from 'arriendos360-shared';

import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { recrearEsquema } from '../../src/database/migraciones';
import {
  levantarDobleContratos,
  levantarDobleIdentidad,
  type DobleContratos,
  type DobleIdentidad,
} from '../dobles/servicios';

export { app, sequelize };

let contratos: DobleContratos | null = null;
let identidad: DobleIdentidad | null = null;

/** Levanta los dobles, los cablea y deja el esquema del servicio limpio. */
export const prepararEntorno = async (): Promise<{
  contratos: DobleContratos;
  identidad: DobleIdentidad;
}> => {
  contratos = await levantarDobleContratos();
  identidad = await levantarDobleIdentidad();

  // Los clientes leen `process.env` en cada llamada, asi que basta con ponerlo.
  process.env['MS_CONTRATOS_URL'] = contratos.url;
  process.env['MS_IDENTIDAD_URL'] = identidad.url;

  await recrearEsquema(sequelize);

  return { contratos, identidad };
};

export const cerrarEntorno = async (): Promise<void> => {
  if (contratos) {
    await contratos.cerrar();
    contratos = null;
  }
  if (identidad) {
    await identidad.cerrar();
    identidad = null;
  }
  delete process.env['MS_CONTRATOS_URL'];
  delete process.env['MS_IDENTIDAD_URL'];
  await sequelize.close();
};

export const contratosFalso = (): DobleContratos => contratos as DobleContratos;
export const identidadFalsa = (): DobleIdentidad => identidad as DobleIdentidad;

export interface Usuario {
  sub: string;
  token: string;
  jti: string;
}

/** Firma un token con la forma que emite ms-identidad. */
export const firmarToken = (
  opciones: { sub?: string; roles?: string[]; jti?: string } = {},
): Usuario => {
  const sub = opciones.sub ?? crypto.randomUUID();
  const jti = opciones.jti ?? crypto.randomUUID();

  const token = jwt.sign(
    {
      sub,
      email: `${sub}@test.com`,
      roles: opciones.roles ?? ['PROPIETARIO'],
      jti,
    },
    process.env['JWT_SECRET'] as jwt.Secret,
    { expiresIn: 3600 },
  );

  return { sub, token, jti };
};

/** Un propietario cualquiera, con token listo. */
export const propietario = (): Usuario => firmarToken({ roles: ['PROPIETARIO'] });

/** Un inquilino cualquiera. */
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
    destinatario: process.env['SERVICIO_NOMBRE'] ?? 'ms-financiero',
    secreto: process.env['SERVICIO_JWT_SECRET'],
  });

  return ['Authorization', cabecera['Authorization'] as string];
};

/** Registra un inmueble en el doble y devuelve su id. */
export const inmuebleDe = (idPropietario: string, direccion = 'Calle 123 #45-67'): string => {
  const id = crypto.randomUUID();
  contratosFalso().inmuebles.set(id, {
    id_inmueble: id,
    id_propietario: idPropietario,
    direccion,
    barrio: 'Centro',
    municipio: 'Bogotá D.C.',
    tipo: 'apartamento',
    estado: 'arrendado',
  });
  return id;
};

/** Registra un usuario en el doble de identidad y devuelve su id. */
export const usuarioDe = (
  roles: string[] = ['INQUILINO'],
  extra: Record<string, unknown> = {},
): string => {
  const id = crypto.randomUUID();
  identidadFalsa().usuarios.set(id, {
    id,
    nombres: 'Nom',
    apellidos: 'Bre',
    email: `${id}@test.com`,
    documento: id.slice(0, 8),
    telefono: '3000000000',
    roles,
    ...extra,
  });
  return id;
};

/**
 * Pone un contrato en el doble de ms-contratos, sin pasar por su API.
 *
 * El contrato no es de este servicio: aqui solo se guardan cuentas de cobro que
 * lo referencian por UUID. Ponerlo en el doble es exactamente lo que ocurre en
 * produccion desde el punto de vista de ms-financiero — el contrato existe en
 * otro sitio y se pregunta por el.
 */
export const contratoEnElDoble = (
  datos: {
    id_inmueble: string;
    id_inquilino: string;
    canon?: number;
    fecha_inicio_corte?: string;
    estado?: string;
  },
): string => {
  const id = crypto.randomUUID();

  contratosFalso().contratos.set(id, {
    id_contrato: id,
    canon: 1000,
    fecha_inicio_corte: '2026-01-01',
    estado: 'activo',
    ...datos,
  });

  return id;
};

/**
 * Un contrato completo: inmueble de un propietario, inquilino, y el contrato.
 *
 * Es el escenario minimo de casi toda suite, porque una cuenta de cobro no
 * significa nada sin un contrato del que colgar y sin alguien a quien
 * pertenecer.
 */
export const escenario = (
  extra: { canon?: number; fecha_inicio_corte?: string; estado?: string } = {},
): { propietario: Usuario; inquilino: Usuario; idInmueble: string; idContrato: string } => {
  const duenio = propietario();
  const arrendatario = inquilino();

  // Los dos usuarios tambien en el doble de identidad: el motor les manda
  // correos y los comprobantes imprimen sus nombres.
  identidadFalsa().usuarios.set(duenio.sub, {
    id: duenio.sub,
    nombres: 'Prop',
    apellidos: 'Ietario',
    email: `${duenio.sub}@test.com`,
    documento: 'PROP1',
    telefono: '3001111111',
    roles: ['PROPIETARIO'],
  });
  identidadFalsa().usuarios.set(arrendatario.sub, {
    id: arrendatario.sub,
    nombres: 'Inqui',
    apellidos: 'Lino',
    email: `${arrendatario.sub}@test.com`,
    documento: 'INQ1',
    telefono: '3002222222',
    roles: ['INQUILINO'],
  });

  const idInmueble = inmuebleDe(duenio.sub);
  const idContrato = contratoEnElDoble({
    id_inmueble: idInmueble,
    id_inquilino: arrendatario.sub,
    ...extra,
  });

  return { propietario: duenio, inquilino: arrendatario, idInmueble, idContrato };
};

/** Emite una cuenta de cobro por la API y devuelve su id. */
export const crearCuenta = async (
  token: string,
  idContrato: string,
  cuerpo: Record<string, unknown> = {},
): Promise<{ respuesta: request.Response; id: string }> => {
  const respuesta = await request(app)
    .post('/api/pagos/cuentas-cobro')
    .set(...conToken(token))
    .send({ id_contrato: idContrato, valor: 1000, inicio: '2026-01-01', ...cuerpo });

  return { respuesta, id: respuesta.body.cuenta_cobro?.id_cuenta_cobro };
};

/**
 * Entrega un evento al consumidor por la MISMA ruta que usa el transporte real.
 *
 * ── NADA DE TEMPORIZADORES, Y NADA DE LLAMAR AL MANEJADOR A MANO ───────────
 *
 * Se hace un POST de verdad a `/interno/eventos`, con credencial de servicio,
 * porque eso ejercita las tres cosas que importan y que un `manejadores[tipo]()`
 * directo no tocaria: que la ruta exija credencial, que el sobre se valide al
 * entrar, y que la idempotencia se aplique donde de verdad esta.
 *
 * Devolver el sobre permite reentregarlo: pasarle el MISMO `id_evento` dos veces
 * es como se comprueba que no se cobra dos veces.
 */
export const entregarEvento = async <T extends TipoEvento>(
  tipo: T,
  payload: Parameters<typeof crearSobre<T>>[1],
  sobreExistente?: SobreEvento<T>,
): Promise<{ respuesta: request.Response; sobre: SobreEvento<T> }> => {
  const sobre = sobreExistente ?? crearSobre(tipo, payload);

  const respuesta = await request(app)
    .post('/interno/eventos')
    .set(...conServicio('ms-contratos'))
    .send(sobre);

  return { respuesta, sobre };
};
