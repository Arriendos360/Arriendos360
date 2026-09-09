/**
 * Cliente de MS-Contratos hacia MS-Inmuebles.
 *
 * ── LA DIRECCION ES CORRECTA, Y CONVIENE DEJARLO ESCRITO ────────────────────
 *
 * Contratos es subdominio **Core** e Inmuebles es **Soporte**. Que Core dependa
 * de Soporte es la direccion natural: lo que no vale es lo contrario, y por eso
 * ms-inmuebles nunca pregunta por contratos —deduce el estado de ocupacion de un
 * evento— y por eso el guardia de borrado de inmuebles vive fuera de el.
 *
 * Es tambien lo que hace innecesario denormalizar `id_propietario` en
 * `contratos`: la pregunta «¿de quien es este inmueble?» se le puede hacer al
 * servicio que lo sabe, en el momento, y la respuesta nunca esta vieja. Ver
 * `docs/adr/0017`.
 *
 * ── TODO LO DE AQUI AUTORIZA, ASI QUE NADA SE DEGRADA ───────────────────────
 *
 * `clientes/inmuebles.js` del gateway distingue dos usos —autorizar y decorar— y
 * degrada solo el segundo. Aqui NO hay segundo: este servicio no compone
 * respuestas con datos de inmuebles, solo comprueba pertenencia. Un fallo de
 * ms-inmuebles se PROPAGA siempre y acaba en un 502, nunca en «no tienes
 * permisos» ni en una lista vacia.
 *
 * La razon es la de siempre: una lista vacia haria que un propietario viera «no
 * tienes contratos», que es una respuesta creible y falsa; y un 403 le diria que
 * no tiene derecho sobre algo suyo cuando en realidad no se ha podido
 * comprobar. Las dos son peores que un error honesto.
 */

import { cabeceraDeServicio } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = Number(process.env['MS_INMUEBLES_TIMEOUT_MS'] ?? 3000);

const DESTINATARIO = 'ms-inmuebles';

/** Lo que este servicio necesita saber de un inmueble: de quien es. */
export interface InmuebleAjeno {
  id_inmueble: string;
  id_propietario: string;
  [clave: string]: unknown;
}

/** URL base del servicio, o null si todavia no esta configurado. */
export const urlBase = (entorno: NodeJS.ProcessEnv = process.env): string | null => {
  const valor = entorno['MS_INMUEBLES_URL'];
  if (typeof valor !== 'string') {
    return null;
  }

  const limpio = valor.trim();
  return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/** GET a `/interno` con credencial de servicio. Todo lo de aqui son consultas. */
const pedirJson = async (url: string): Promise<{ inmuebles?: InmuebleAjeno[] }> => {
  const respuesta = await fetch(url, {
    headers: cabeceraDeServicio({
      emisor: process.env['SERVICIO_NOMBRE'] ?? 'ms-contratos',
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (!respuesta.ok) {
    throw new Error(`ms-inmuebles respondió ${respuesta.status} a ${url}`);
  }

  return (await respuesta.json()) as { inmuebles?: InmuebleAjeno[] };
};

/**
 * Los identificadores de los inmuebles de un propietario.
 *
 * Es la mitad cara de la disyuncion de pertenencia: «los contratos sobre mis
 * inmuebles». La otra mitad —«los contratos donde soy el inquilino»— es una
 * columna de esta misma base y no cuesta nada.
 *
 * @throws si el servicio no responde. Ver la nota de cabecera.
 */
export const idsDePropietario = async (
  sub: string,
  opciones: { urlBase?: string | null } = {},
): Promise<string[]> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    return [];
  }

  const datos = await pedirJson(
    `${base}/interno/inmuebles?propietario=${encodeURIComponent(sub)}`,
  );

  return (datos.inmuebles ?? []).map((inmueble) => inmueble.id_inmueble);
};

/**
 * Un inmueble, SOLO si es de este propietario. `null` en cualquier otro caso.
 *
 * La comprobacion se hace aqui, contra el `id_propietario` que devuelve el
 * servicio, y no pidiendole al servicio que filtre: asi el que autoriza es quien
 * tiene el `sub`.
 *
 * @throws si el servicio no responde.
 */
export const propioDe = async (
  idInmueble: string,
  sub: string,
  opciones: { urlBase?: string | null } = {},
): Promise<InmuebleAjeno | null> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null || !idInmueble) {
    return null;
  }

  const datos = await pedirJson(
    `${base}/interno/inmuebles?ids=${encodeURIComponent(idInmueble)}`,
  );
  const inmueble = (datos.inmuebles ?? [])[0];

  return inmueble && inmueble.id_propietario === sub ? inmueble : null;
};
