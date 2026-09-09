/**
 * Cliente de MS-Financiero hacia MS-Identidad.
 *
 * Dos cosas, con dos politicas de fallo distintas:
 *
 * 1. **`invalidacionesVigentes`** — que tokens dejaron de valer. La consume el
 *    refresco de la cache cada 15 s. El fallo SE PROPAGA: la cache necesita
 *    distinguir «no hay nada que invalidar» de «no pude preguntar», porque
 *    confundirlas dejaria entrar tokens de sesiones cerradas.
 *
 * 2. **`usuariosPorIds`** — el nombre del arrendatario que imprime un
 *    comprobante y el correo al que el motor avisa. El fallo DEGRADA a un mapa
 *    vacio: un recibo con «No disponible» donde va el nombre sigue sirviendo;
 *    un 500 al pedir el recibo, no. Y un barrido que no manda un correo es un
 *    incidente menor comparado con uno que no genera las cuentas del mes.
 *
 * EN LOTE, SIEMPRE. Un listado de veinte comprobantes pediria veinte veces lo
 * mismo si la consulta fuera de una en una: el N+1 de siempre, pero con latencia
 * de red. Los llamantes recogen todos los identificadores y hacen UNA peticion.
 *
 * ── ESTE CLIENTE TIENE FECHA DE CADUCIDAD PARCIAL ───────────────────────────
 *
 * Los correos del motor —el aviso de vencimiento proximo y el de mora— se
 * componen aqui HOY porque ms-notificaciones no existe todavia. En el paso 7 eso
 * cambia de forma: el motor pasara a publicar eventos («cuenta proxima a
 * vencer», «cuenta en mora») y sera Notificaciones quien resuelva a quien avisar
 * y por que canal. Entonces `usuariosPorIds` seguira haciendo falta para los
 * PDF, que no son una notificacion, pero el motor dejara de llamarlo.
 *
 * Se deja escrito aqui y en `services/motor.ts` para que la deuda tenga dueño y
 * no se descubra leyendo el codigo.
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
 * Peticion GET a un endpoint `/interno`, firmada y con tiempo limite.
 *
 * La credencial se firma en cada llamada en vez de reutilizarla: el token dura
 * un minuto, asi que cachearlo ahorraria una firma HMAC —microsegundos— a cambio
 * de tener que gestionar su caducidad. No compensa.
 */
const pedirJson = async (url: string): Promise<unknown> => {
  const respuesta = await fetch(url, {
    headers: cabeceraDeServicio({
      emisor: process.env['SERVICIO_NOMBRE'] ?? 'ms-financiero',
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
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
 * El fallo SE PROPAGA: lo consume el refresco de la cache. Ver la nota 1.
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
 * Datos de varios usuarios, indexados por id.
 *
 * DEGRADA a un mapa vacio. Ver la nota 2 de la cabecera.
 */
export const usuariosPorIds = async (
  ids: Array<string | null | undefined>,
  opciones: { urlBase?: string | null } = {},
): Promise<Map<string, UsuarioAjeno>> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];

  if (base === null || unicos.length === 0) {
    return new Map();
  }

  try {
    const datos = (await pedirJson(
      `${base}/interno/usuarios?ids=${encodeURIComponent(unicos.join(','))}`,
    )) as { usuarios?: UsuarioAjeno[] };

    return new Map((datos.usuarios ?? []).map((usuario) => [usuario.id, usuario]));
  } catch (error) {
    console.error(
      '⚠️  ms-financiero: no se pudieron obtener usuarios de ms-identidad:',
      (error as Error).message,
    );
    return new Map();
  }
};
