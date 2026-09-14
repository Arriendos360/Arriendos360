/**
 * Cliente de MS-Notificaciones hacia MS-Identidad.
 *
 * ── ES LA UNICA DEPENDENCIA DEL SERVICIO, Y EXISTE POR UNA REGLA ────────────
 *
 * Los eventos NO LLEVAN DIRECCIONES DE CORREO. Llevan el `id_usuario`, y el
 * destinatario se resuelve aqui. La razon es de propiedad del dato: un correo
 * pertenece a `identidad.usuarios` y a nadie mas; copiarlo en un sobre convertiria
 * a cada emisor —ms-identidad y ms-financiero— en responsable de un dato de
 * contacto que no le pertenece, y dejaria copias viejas en dos tablas de salida
 * que no tienen forma de enterarse de que alguien cambio su correo.
 *
 * El precio es este salto de red, y se paga en el unico momento en el que la
 * respuesta es actual: al manejar el evento.
 *
 * ── AQUI EL FALLO SE PROPAGA. NO DEGRADA ────────────────────────────────────
 *
 * Y es la diferencia mas importante con el cliente equivalente de ms-financiero,
 * que para lo mismo DEGRADA a un mapa vacio.
 *
 * Alli tenia sentido: el que preguntaba era el motor, cuyo trabajo principal es
 * facturar, y un barrido que genera las cuentas del mes sin mandar el correo es
 * mejor que uno que no genera nada. Aqui el correo ES el trabajo. Degradar
 * significaria devolver un destinatario vacio y dar el evento por procesado, es
 * decir, PERDER el aviso sin que nada lo registre — y con la marca del evento ya
 * puesta, el productor no lo reintentaria nunca.
 *
 * Asi que `destinatariosDe` LANZA. El manejador deja subir la excepcion, la
 * transaccion del consumidor se va entera —incluida la marca del `id_evento`— y el
 * `500` le dice al productor que lo reintente. El evento sigue en su tabla de
 * salida, con su espera creciente y su apartado tras diez intentos. No se pierde.
 *
 * Es exactamente la distincion que la cabecera de `apps/gateway/src/clientes/inmuebles.js`
 * hace entre componer para decorar y componer para autorizar, aplicada a un tercer
 * caso: componer para PODER ACTUAR.
 *
 * ── EN LOTE, SIEMPRE ────────────────────────────────────────────────────────
 *
 * Un evento puede tener dos destinatarios —inquilino y propietario— y se piden en
 * UNA peticion. No es una optimizacion prematura: es que el endpoint ya acepta una
 * lista, y pedir de uno en uno dentro de una transaccion abierta seria mantenerla
 * abierta el doble de tiempo por nada.
 */

import { cabeceraDeServicio } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = Number(process.env['MS_IDENTIDAD_TIMEOUT_MS'] ?? 3000);

const DESTINATARIO = 'ms-identidad';

/** Lo que este servicio mira de un usuario: a donde escribirle y como llamarle. */
export interface UsuarioAjeno {
  id: string;
  nombres?: string;
  apellidos?: string;
  email?: string;
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
 * Datos de varios usuarios, indexados por id.
 *
 * LANZA si no se puede preguntar o si la respuesta no es 2xx. Ver la cabecera.
 */
export const usuariosPorIds = async (
  ids: Array<string | null | undefined>,
  opciones: { urlBase?: string | null } = {},
): Promise<Map<string, UsuarioAjeno>> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];

  if (unicos.length === 0) {
    return new Map();
  }

  if (base === null) {
    // Sin fuente no se puede resolver a nadie, y callarlo seria perder el aviso.
    // El arranque del servicio ya lo advierte; esto lo convierte en un fallo
    // observable en vez de en un correo que no sale.
    throw new Error(
      'MS_IDENTIDAD_URL sin definir: no se puede resolver el destinatario de la notificación',
    );
  }

  const url = `${base}/interno/usuarios?ids=${encodeURIComponent(unicos.join(','))}`;

  const respuesta = await fetch(url, {
    headers: cabeceraDeServicio({
      emisor: process.env['SERVICIO_NOMBRE'] ?? 'ms-notificaciones',
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (!respuesta.ok) {
    throw new Error(`ms-identidad respondió ${respuesta.status} a ${url}`);
  }

  const datos = (await respuesta.json()) as { usuarios?: UsuarioAjeno[] };

  return new Map((datos.usuarios ?? []).map((usuario) => [usuario.id, usuario]));
};

/** A quien se avisa: el usuario, con su correo ya resuelto. */
export interface Destinatario {
  id_usuario: string;
  email: string;
  nombres: string;
}

/**
 * Resuelve los destinatarios de una lista de identificadores.
 *
 * ── UN USUARIO SIN CORREO NO ES UN FALLO DE RED, Y SE TRATA DISTINTO ────────
 *
 * Que ms-identidad no conteste es transitorio y merece un reintento. Que conteste
 * y el usuario no exista, o no tenga correo, no se arregla reintentando: son diez
 * intentos y un evento apartado para nada.
 *
 * Asi que esos se OMITEN de la lista, y el manejador decide. Hoy todos los
 * manejadores hacen lo mismo —redactan para los que si se pudieron resolver— con
 * una excepcion deliberada: si no se pudo resolver a NADIE, `manejadores`
 * registra el aviso perdido. Un evento que no avisa a nadie no puede pasar en
 * silencio.
 *
 * `documento` y `telefono` no se piden aunque el endpoint los devuelva: este
 * servicio no los usa y no tiene por que tenerlos en memoria.
 */
export const destinatariosDe = async (
  ids: Array<string | null | undefined>,
): Promise<Map<string, Destinatario>> => {
  const usuarios = await usuariosPorIds(ids);
  const resueltos = new Map<string, Destinatario>();

  for (const [id, usuario] of usuarios) {
    const email = usuario.email?.trim();
    if (!email) {
      continue;
    }

    resueltos.set(id, {
      id_usuario: id,
      email,
      nombres: usuario.nombres?.trim() ?? '',
    });
  }

  return resueltos;
};
