/**
 * Cliente de MS-Contratos hacia MS-Identidad.
 *
 * Tres cosas, con tres politicas de fallo distintas, y la diferencia importa:
 *
 * 1. **`invalidacionesVigentes`** — que tokens dejaron de valer. La consume el
 *    refresco de la cache cada 15 s. El fallo SE PROPAGA: la cache necesita
 *    distinguir «no hay nada que invalidar» de «no pude preguntar», porque
 *    confundirlas dejaria entrar tokens de sesiones cerradas.
 *
 * 2. **`usuarioPorId`** — para comprobar que el inquilino de un contrato existe
 *    y tiene ese rol antes de firmar. El fallo se traduce en «no encontrado»,
 *    que es lo prudente: ante la duda no se firma un contrato contra un usuario
 *    que quiza no exista.
 *
 * 3. **`reemitirContrasenaTemporal`** — el fallo SE PROPAGA. Si la reemision no
 *    ocurrio, el propietario tiene que saberlo: devolverle una contraseña que no
 *    esta guardada seria peor que un error.
 *
 * ── POR QUE LA REEMISION VIVE EN ESTE SERVICIO DESDE EL PASO 6d ─────────────
 *
 * El `docs/adr/0010` la puso en el gateway con este argumento: la regla de
 * autorizacion es «solo sobre inquilinos con contrato en mis inmuebles», y
 * ms-identidad no puede comprobarla sin depender de un servicio de dominio e
 * invertir la direccion de las dependencias.
 *
 * El argumento sigue siendo valido y la conclusion cambia, porque cambio quien
 * tiene los datos. Ahora los contratos son de este servicio y preguntar por los
 * inmuebles es Core -> Soporte, que es la direccion buena. El gateway ya no
 * aporta nada al hacerlo el: solo reenvia. Ver `docs/adr/0017`.
 */

import { cabeceraDeServicio } from 'arriendos360-shared';
import type { Invalidaciones } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = Number(process.env['MS_IDENTIDAD_TIMEOUT_MS'] ?? 3000);

const DESTINATARIO = 'ms-identidad';

/** Lo que este servicio mira de un usuario. */
export interface UsuarioAjeno {
  id: string;
  nombres?: string;
  apellidos?: string;
  email?: string;
  documento?: string;
  telefono?: string;
  roles?: string[];
}

/** URL base del servicio, o null si no esta configurado. */
export const urlBase = (entorno: NodeJS.ProcessEnv = process.env): string | null => {
  const valor = entorno['MS_IDENTIDAD_URL'];
  if (typeof valor !== 'string') {
    return null;
  }

  const limpio = valor.trim();
  return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/**
 * Peticion a un endpoint `/interno`, firmada y con tiempo limite.
 *
 * La credencial se firma en cada llamada en vez de reutilizarla: el token dura
 * un minuto, asi que cachearlo ahorraria una firma HMAC —microsegundos— a cambio
 * de tener que gestionar su caducidad.
 */
const pedirJson = async (
  url: string,
  metodo: 'GET' | 'POST' = 'GET',
  cuerpo: unknown = null,
): Promise<unknown> => {
  const respuesta = await fetch(url, {
    method: metodo,
    headers: {
      ...cabeceraDeServicio({
        emisor: process.env['SERVICIO_NOMBRE'] ?? 'ms-contratos',
        destinatario: DESTINATARIO,
        secreto: process.env['SERVICIO_JWT_SECRET'],
      }),
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (!respuesta.ok) {
    throw new Error(`ms-identidad respondió ${respuesta.status} a ${url}`);
  }

  return respuesta.json();
};

/**
 * Trae los `jti` revocados y las sesiones caidas.
 *
 * El fallo SE PROPAGA: lo consume el refresco de la cache. Ver la nota 1 de la
 * cabecera.
 */
export const invalidacionesVigentes = async (
  opciones: { urlBase?: string | null } = {},
): Promise<Invalidaciones> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    return { revocados: [], sesiones: [] };
  }

  return (await pedirJson(`${base}/interno/revocados`)) as Invalidaciones;
};

/**
 * Datos de un usuario, o `null` si no existe o no se pudo preguntar.
 *
 * Degrada a `null` a proposito: quien llama lo traduce en «inquilino no
 * encontrado» y no firma. Ver la nota 2 de la cabecera.
 */
export const usuarioPorId = async (
  id: string,
  opciones: { urlBase?: string | null } = {},
): Promise<UsuarioAjeno | null> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null || !id) {
    return null;
  }

  try {
    const datos = (await pedirJson(
      `${base}/interno/usuarios?ids=${encodeURIComponent(id)}`,
    )) as { usuarios?: UsuarioAjeno[] };

    return (datos.usuarios ?? [])[0] ?? null;
  } catch (error) {
    console.error(
      '⚠️  ms-contratos: no se pudo consultar el usuario en ms-identidad:',
      (error as Error).message,
    );
    return null;
  }
};

export interface ReemisionContrasena {
  contrasena_temporal: string;
  usuario: UsuarioAjeno;
}

/**
 * Pide a ms-identidad que regenere la contraseña temporal de un usuario.
 *
 * Quien puede pedirlo lo decide ESTE servicio antes de llamar: la regla es que
 * el usuario sea inquilino de un contrato sobre un inmueble del propietario, y
 * eso son datos de aqui mas una pregunta a ms-inmuebles.
 *
 * El fallo SE PROPAGA. Ver la nota 3 de la cabecera.
 */
export const reemitirContrasenaTemporal = async (
  idUsuario: string,
  solicitadoPor: string,
  opciones: { urlBase?: string | null } = {},
): Promise<ReemisionContrasena> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    throw new Error('MS_IDENTIDAD_URL no está configurada');
  }

  return (await pedirJson(
    `${base}/interno/usuarios/${encodeURIComponent(idUsuario)}/contrasena-temporal`,
    'POST',
    // Quien lo pidio, para que la auditoria del otro lado registre a la persona
    // y no al servicio que transmitio.
    { solicitado_por: solicitadoPor },
  )) as ReemisionContrasena;
};
