/**
 * Utilidades comunes de las pruebas de MS-Identidad.
 *
 * Corren contra PostgreSQL, pero sólo contra el esquema `identidad` de la base
 * de pruebas: `recrearEsquema()` hace `DROP SCHEMA identidad CASCADE`, así que
 * las tablas del gateway en `public` quedan intactas aunque compartan base.
 *
 * ── DESDE EL PASO 7 HAY QUE MIRAR LA TABLA DE SALIDA ────────────────────────
 *
 * Este servicio ya no manda correos: anota eventos. Así que donde antes las pruebas
 * de recuperación leían un buzón falso, ahora leen `identidad.eventos_salida` con
 * `eventosDeSalida()`. Es una prueba mejor, y no sólo una adaptación: el buzón
 * comprobaba lo que el servicio había redactado, y esto comprueba lo que de verdad
 * sale por el bus — que es lo único que otro servicio va a ver.
 *
 * Y `entregarEventos()` corre un ciclo del publicador a mano, contra un doble que
 * hace de ms-notificaciones. Nada de temporizadores, como en las suites del gateway.
 */

import express from 'express';
import type { Server } from 'http';
import request from 'supertest';
import { cabeceraDeServicio, exigirServicio, filasDe } from 'arriendos360-shared';

import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { recrearEsquema } from '../../src/database/migraciones';
import { TABLA_SALIDA, crearPublicadorDeSalida } from '../../src/eventos';

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

// ── El bus ──────────────────────────────────────────────────────────────────

/** Una fila de la tabla de salida, tal como la miran las pruebas. */
export interface FilaDeSalida {
  id_evento: string;
  tipo: string;
  version: number;
  payload: Record<string, unknown>;
  clave_orden: string | null;
  estado: string;
  intentos: number;
}

/**
 * Lo que hay en `identidad.eventos_salida`, por orden de registro.
 *
 * Se consulta por SQL y no por la API a propósito: el sobre no aparece en ninguna
 * respuesta —viaja de este servicio a sus suscriptores por la red interna— así que
 * ésta es la única forma de ver lo que de verdad se emitió.
 */
export const eventosDeSalida = async (tipo?: string): Promise<FilaDeSalida[]> => {
  const filtro = tipo ? `WHERE tipo = :tipo` : ``;

  const resultado = await sequelize.query(
    `SELECT id_evento, tipo, version, payload, clave_orden, estado, intentos
       FROM ${TABLA_SALIDA} ${filtro}
      ORDER BY registrado_en ASC, id_evento ASC`,
    tipo ? { replacements: { tipo } } : {},
  );

  return filasDe<FilaDeSalida>(resultado);
};

/** Un suscriptor de pega: registra lo que le entregan y puede negarse. */
export interface DobleNotificaciones {
  url: string;
  recibidos: Array<{ id_evento: string; tipo: string; payload: Record<string, unknown> }>;
  caer: (codigo?: number) => void;
  levantar: () => void;
  cerrar: () => Promise<void>;
}

/**
 * Doble de ms-notificaciones.
 *
 * VERIFICA LA CREDENCIAL CON LA MISMA PIEZA QUE EL REAL, no con una comprobación de
 * que la cabecera «parece» correcta: `POST /interno/eventos` es la entrada del bus, y
 * un doble más laxo que el servicio real deja pasar suites verdes sobre un transporte
 * roto. Es la convención de CLAUDE.md — «el doble de pruebas también la exige».
 */
export const levantarDobleNotificaciones = async (): Promise<DobleNotificaciones> => {
  const doble = express();
  doble.use(express.json());

  const recibidos: DobleNotificaciones["recibidos"] = [];
  let fallarCon: number | null = null;

  doble.use(
    "/interno",
    exigirServicio({
      destinatario: "ms-notificaciones",
      secreto: process.env["SERVICIO_JWT_SECRET"],
    }),
  );

  doble.post("/interno/eventos", (peticion, respuesta) => {
    if (fallarCon !== null) {
      return respuesta.status(fallarCon).json({ mensaje: "Doble caído a propósito" });
    }

    recibidos.push({
      id_evento: peticion.body?.id_evento,
      tipo: peticion.body?.tipo,
      payload: peticion.body?.payload,
    });

    return respuesta.json({ mensaje: "Evento procesado" });
  });

  const servidor = await new Promise<Server>((resolver) => {
    const s = doble.listen(0, "127.0.0.1", () => resolver(s));
  });

  const direccion = servidor.address();
  const puerto = typeof direccion === "object" && direccion ? direccion.port : 0;

  return {
    url: `http://127.0.0.1:${puerto}`,
    recibidos,
    caer: (codigo = 503) => {
      fallarCon = codigo;
    },
    levantar: () => {
      fallarCon = null;
    },
    cerrar: () =>
      new Promise((resolver, rechazar) => {
        servidor.close((error) => (error ? rechazar(error) : resolver()));
      }),
  };
};

/**
 * Un ciclo del publicador, a mano.
 *
 * NADA DE TEMPORIZADORES. El publicador no se arranca: es lo que hace que «todavía no
 * se ha entregado» sea una afirmación comprobable y no una carrera. Usa el almacén y
 * la entrega reales; sólo quita la espera entre reintentos.
 */
export const entregarEventos = () =>
  crearPublicadorDeSalida({
    esperaBaseMs: 0,
    esperaMaximaMs: 0,
    registrar: () => undefined,
  }).ciclo();
