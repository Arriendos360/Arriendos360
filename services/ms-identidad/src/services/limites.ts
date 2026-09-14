/**
 * Limitacion de tasa de las rutas publicas de ms-identidad.
 *
 * ── POR QUE AQUI Y NO EN EL GATEWAY ────────────────────────────────────────
 *
 * Contar intentos fallidos por cuenta exige leer el correo del cuerpo y saber si la
 * contrasena coincidio. El gateway reenvia el cuerpo sin leerlo y no sabe como acabo
 * el login. Las cuatro rutas ya llegan aqui, asi que contar aqui no anade ningun
 * salto de red, y el gateway sigue sin base. Ver `docs/adr/0020`.
 *
 * ── LOS CONTADORES ─────────────────────────────────────────────────────────
 *
 *   login        por IP, todos los intentos                 100 / 15 min
 *   login        por cuenta e IP, solo los FALLIDOS           5 / 15 min
 *   registro     por IP                                      10 / hora
 *   recuperar    por IP                                       5 / hora
 *   recuperar    por cuenta, SILENCIOSO                       3 / hora
 *   restablecer  por IP                                       5 / hora
 *
 * No hay contador de login solo por cuenta, y es deliberado: seria un mecanismo de
 * bloqueo a pedido. Fallar el login de alguien bloquea la IP del atacante para esa
 * cuenta, no a la victima.
 *
 * ── LA IP ──────────────────────────────────────────────────────────────────
 *
 * La que firma el gateway (`x-origen-cliente`), o la de la conexion si la firma
 * falta o no vale. Agrupada: una IPv4 cuenta sola, una IPv6 por su /64, que es lo
 * que un proveedor asigna a un cliente y lo que un atacante podria rotar gratis.
 *
 * ── LA VENTANA ─────────────────────────────────────────────────────────────
 *
 * Fija: se cuenta desde el inicio de la ventana en curso. Permite una rafaga del
 * doble justo en el cambio de ventana; se acepta a cambio de una sola sentencia.
 */

import crypto from 'crypto';
import net from 'net';
import type { NextFunction, Request, Response } from 'express';
import {
  CABECERA_ORIGEN_CLIENTE,
  crearError,
  filasDe,
  leerEntorno,
  textoDeEntorno,
  verificarOrigenCliente,
} from 'arriendos360-shared';

import { ESQUEMA, sequelize } from '../config/database';

const TABLA = `${ESQUEMA}.limites_tasa`;

export interface Limite {
  /** Prefijo de la clave. Distingue los contadores entre si. */
  nombre: string;
  maximo: number;
  ventanaSegundos: number;
}

export const LIMITES_POR_DEFECTO = {
  loginPorIp: { nombre: 'login-ip', maximo: 100, ventanaSegundos: 15 * 60 },
  loginFallidosPorCuentaEIp: { nombre: 'login-fallos', maximo: 5, ventanaSegundos: 15 * 60 },
  registroPorIp: { nombre: 'registro-ip', maximo: 10, ventanaSegundos: 60 * 60 },
  recuperarPorIp: { nombre: 'recuperar-ip', maximo: 5, ventanaSegundos: 60 * 60 },
  recuperarPorCuenta: { nombre: 'recuperar-cuenta', maximo: 3, ventanaSegundos: 60 * 60 },
  restablecerPorIp: { nombre: 'restablecer-ip', maximo: 5, ventanaSegundos: 60 * 60 },
} satisfies Record<string, Limite>;

export type NombreLimite = keyof typeof LIMITES_POR_DEFECTO;

let limites: Record<NombreLimite, Limite> = { ...LIMITES_POR_DEFECTO };
let reloj: () => number = () => Date.now();

/** Los limites en vigor. */
export const limite = (nombre: NombreLimite): Limite => limites[nombre];

/** Sustituye limites concretos. Lo usan las pruebas. */
export const usarLimites = (cambios: Partial<Record<NombreLimite, Partial<Limite>>>): void => {
  limites = { ...limites };
  for (const [nombre, cambio] of Object.entries(cambios) as Array<[NombreLimite, Partial<Limite>]>) {
    limites[nombre] = { ...limites[nombre], ...cambio };
  }
};

/** Vuelve a los limites de produccion. */
export const restablecerLimites = (): void => {
  limites = { ...LIMITES_POR_DEFECTO };
};

/** Sustituye el reloj, para mover la ventana sin esperar. `null` vuelve al real. */
export const usarReloj = (nuevo: (() => number) | null): void => {
  reloj = nuevo ?? (() => Date.now());
};

// ── Lo que se cuenta ─────────────────────────────────────────────────────────

/** Correo normalizado, para que `A@x.com` y `a@x.com ` cuenten igual. */
export const normalizarEmail = (email: unknown): string => String(email ?? '').trim().toLowerCase();

/**
 * La IP agrupada. IPv4 tal cual (tambien la mapeada `::ffff:a.b.c.d`); IPv6 por su
 * /64. Lo que no es una IP se devuelve tal cual: sigue contando, aunque no agrupe.
 */
export const grupoDeIp = (ip: string): string => {
  const limpia = ip.trim().replace(/%.*$/, '');
  const mapeada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(limpia);
  if (mapeada?.[1]) {
    return mapeada[1];
  }

  if (net.isIPv4(limpia) || !net.isIPv6(limpia)) {
    return limpia;
  }

  const grupos = (texto: string): string[] => {
    if (texto === '') {
      return [];
    }
    const partes = texto.split(':');
    // Una IPv4 incrustada al final ocupa dos grupos.
    return partes.flatMap((parte) => (parte.includes('.') ? ['0', '0'] : [parte]));
  };

  const [cabeza = '', cola] = limpia.split('::');
  const delante = grupos(cabeza);
  const detras = cola === undefined ? [] : grupos(cola);
  const completos = [
    ...delante,
    ...Array<string>(8 - delante.length - detras.length).fill('0'),
    ...detras,
  ];

  return `${completos
    .slice(0, 4)
    .map((grupo) => parseInt(grupo, 16).toString(16))
    .join(':')}::/64`;
};

/** La IP del cliente: la firmada por el gateway, o la de la conexion. */
export const ipDeOrigen = (req: Request): string =>
  verificarOrigenCliente(req.headers[CABECERA_ORIGEN_CLIENTE], {
    destinatario: textoDeEntorno('SERVICIO_NOMBRE', 'ms-identidad'),
    secreto: leerEntorno('SERVICIO_JWT_SECRET'),
  }) ??
  req.socket.remoteAddress ??
  'desconocida';

/** `ju***@dominio.com`: lo justo para reconocer el caso en un log. */
export const enmascararEmail = (email: string): string => {
  const [local = '', dominio = ''] = normalizarEmail(email).split('@');
  return `${local.slice(0, 2)}***@${dominio}`;
};

// ── El almacen ───────────────────────────────────────────────────────────────

const claveDe = (lim: Limite, partes: string[]): string =>
  `${lim.nombre}:${crypto.createHash('sha256').update(partes.join('|')).digest('hex')}`;

const ventanaDe = (lim: Limite): string => {
  const ancho = lim.ventanaSegundos * 1000;
  return new Date(Math.floor(reloj() / ancho) * ancho).toISOString();
};

/**
 * Suma un intento y devuelve cuantos lleva la clave en la ventana en curso.
 *
 * Una sola sentencia: atomica aunque varias replicas cuenten la misma clave a la vez.
 */
export const contar = async (lim: Limite, partes: string[]): Promise<number> => {
  const resultado = await sequelize.query(
    `INSERT INTO ${TABLA} (clave, ventana, cuenta)
     VALUES (:clave, :ventana, 1)
     ON CONFLICT (clave, ventana) DO UPDATE SET cuenta = ${TABLA}.cuenta + 1
     RETURNING cuenta`,
    { replacements: { clave: claveDe(lim, partes), ventana: ventanaDe(lim) } },
  );

  return Number(filasDe<{ cuenta: number }>(resultado)[0]?.cuenta ?? 0);
};

/** Cuantos intentos lleva la clave en la ventana en curso, sin sumar ninguno. */
export const consultar = async (lim: Limite, partes: string[]): Promise<number> => {
  const resultado = await sequelize.query(
    `SELECT cuenta FROM ${TABLA} WHERE clave = :clave AND ventana = :ventana`,
    { replacements: { clave: claveDe(lim, partes), ventana: ventanaDe(lim) } },
  );

  return Number(filasDe<{ cuenta: number }>(resultado)[0]?.cuenta ?? 0);
};

/** Borra las ventanas que ya no pueden contar para nada. */
export const purgarVencidos = async (): Promise<void> => {
  const ventanaMasLarga = Math.max(...Object.values(limites).map((lim) => lim.ventanaSegundos));
  await sequelize.query(`DELETE FROM ${TABLA} WHERE ventana < :antes`, {
    replacements: { antes: new Date(reloj() - 2 * ventanaMasLarga * 1000).toISOString() },
  });
};

// ── La respuesta ─────────────────────────────────────────────────────────────

export const MENSAJE_LIMITE = 'Demasiados intentos. Inténtalo más tarde.';

/**
 * 429 con `Retry-After` igual a la ventana COMPLETA, no a lo que falta.
 *
 * Todas estas rutas son de autenticacion: decir cuanto falta para desbloquear le
 * dice a un atacante exactamente cuando volver. Por lo mismo, ninguna cabecera de
 * cuota restante.
 */
export const responderLimite = (res: Response, lim: Limite): Response =>
  res.set('Retry-After', String(lim.ventanaSegundos)).status(429).json(crearError(MENSAJE_LIMITE));

/**
 * Middleware que cuenta la peticion contra un limite por IP.
 *
 * Si el almacen falla responde 503: son rutas de autenticacion, y dejar pasar sin
 * contar es exactamente lo que el limite existe para impedir. Tampoco se pierde
 * nada: sin base, estas rutas fallarian igual un paso despues.
 */
export const limitarPorIp =
  (nombre: NombreLimite) =>
  async (req: Request, res: Response, siguiente: NextFunction): Promise<Response | void> => {
    const lim = limite(nombre);

    try {
      const intentos = await contar(lim, [grupoDeIp(ipDeOrigen(req))]);
      if (intentos > lim.maximo) {
        return responderLimite(res, lim);
      }
    } catch (error) {
      console.error(`❌ ms-identidad: no se pudo comprobar el límite ${lim.nombre}:`, (error as Error).message);
      return res
        .status(503)
        .json(crearError('No se pudo comprobar el límite de intentos. Inténtalo más tarde.'));
    }

    return siguiente();
  };
