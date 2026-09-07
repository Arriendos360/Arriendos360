/**
 * Autenticacion entre servicios.
 *
 * Los endpoints `/interno` no los llama una persona: los llama otro servicio.
 * Hasta ahora su unica proteccion era la red, y eso contradice la regla dura 7
 * —confianza cero: ninguna peticion se considera confiable por venir de la red
 * interna— ademas de no ser cierto: en Compose el puerto esta publicado, asi que
 * cualquier proceso del host llegaba a ellos.
 *
 * El mecanismo es un JWT de vida corta que el llamante firma y el destinatario
 * verifica. Se eligio frente a un secreto compartido en cabecera por una razon
 * concreta: con el secreto en cabecera, la credencial VIAJA en cada peticion, y
 * basta con que una traza de APM o un log de proxy capture una llamada para que
 * quien lo lea tenga acceso permanente. Aqui la clave nunca sale del proceso; lo
 * que viaja es un token derivado que caduca en un minuto.
 *
 * TRES DECISIONES QUE NO SON DECORATIVAS
 *
 * 1. **Secreto distinto del de usuario.** `SERVICIO_JWT_SECRET` no es
 *    `JWT_SECRET`. Si compartieran clave, el token de cualquier inquilino
 *    serviria para llamar a `/interno` y leerse la tabla de usuarios entera.
 *
 * 2. **Esquema propio, no `Bearer`.** La cabecera es `Authorization: Servicio
 *    <token>`. El verificador exige ese esquema, de modo que un token de usuario
 *    no puede colarse ni por accidente. Es la segunda barrera sobre la primera.
 *
 * 3. **La clave se resuelve por emisor.** Hoy todos los servicios comparten una,
 *    que es lo que el proyecto puede operar. Pasar a clave por servicio —para
 *    que comprometer uno no permita suplantar a otro— es cambiar la funcion
 *    `resolverClave`, no rediseñar esto. Queda anotado como decision abierta.
 */

import jwt from 'jsonwebtoken';

import {
  ESTADO_SIN_TOKEN,
  type ErrorRespuesta,
  crearError,
} from './errores';

/** Esquema de la cabecera `Authorization` para llamadas entre servicios. */
export const ESQUEMA_SERVICIO = 'Servicio';

/**
 * Vida del token, en segundos.
 *
 * Un minuto: de sobra para una llamada entre contenedores y lo bastante corto
 * para que un token capturado no sirva de nada. No se hace mas corto porque
 * entonces el desfase de reloj entre maquinas empezaria a importar mas que la
 * ventana que se quiere cerrar.
 */
export const VIGENCIA_POR_DEFECTO_SEGUNDOS = 60;

/** Margen de desfase de reloj admitido al verificar. */
export const TOLERANCIA_RELOJ_SEGUNDOS = 10;

/**
 * Respuesta unica ante cualquier fallo de autenticacion de servicio.
 *
 * No distingue entre «no mandaste credencial», «la firma no cuadra» y «el token
 * expiro». A un llamante legitimo le da igual —es una maquina, no va a corregir
 * nada leyendo el mensaje— y a quien este probando no le regala pistas.
 */
export const MENSAJE_SERVICIO_NO_AUTENTICADO = 'Autenticación de servicio requerida.';

/** Claims de un token de servicio. */
export interface ClaimsServicio {
  /** Quien llama: `gateway`, `ms-identidad`, ... */
  iss: string;
  /** A quien va dirigido. Un token para uno no sirve contra otro. */
  aud: string;
  iat?: number;
  exp?: number;
}

export interface OpcionesFirma {
  /** Nombre de este servicio, el que llama. */
  emisor: string;
  /** Nombre del servicio al que se llama. */
  destinatario: string;
  secreto: string | undefined;
  vigenciaSegundos?: number;
}

/** Firma un token de servicio. */
export function firmarTokenDeServicio(opciones: OpcionesFirma): string {
  if (!opciones.secreto) {
    throw new Error(
      'Falta SERVICIO_JWT_SECRET: no se puede firmar una llamada entre servicios sin clave.',
    );
  }

  return jwt.sign({}, opciones.secreto, {
    issuer: opciones.emisor,
    audience: opciones.destinatario,
    expiresIn: opciones.vigenciaSegundos ?? VIGENCIA_POR_DEFECTO_SEGUNDOS,
  });
}

/**
 * Cabeceras listas para una llamada entre servicios.
 *
 * Se devuelve el objeto entero y no solo el token para que quien llame no tenga
 * que acordarse del nombre del esquema.
 */
export function cabeceraDeServicio(opciones: OpcionesFirma): Record<string, string> {
  return {
    Authorization: `${ESQUEMA_SERVICIO} ${firmarTokenDeServicio(opciones)}`,
  };
}

/** De donde sale el token en la peticion entrante. */
export interface FuenteTokenServicio {
  authorization?: string | undefined;
}

/**
 * Extrae el token del esquema `Servicio`.
 *
 * Devuelve `undefined` si falta la cabecera o si el esquema es otro. Que un
 * `Bearer` no valga aqui es deliberado: separa el trafico de usuarios del
 * trafico entre servicios incluso si alguien se equivocara de secreto.
 */
export function extraerTokenDeServicio(fuente: FuenteTokenServicio): string | undefined {
  const cabecera = fuente.authorization;
  if (!cabecera) {
    return undefined;
  }

  const [esquema, valor] = cabecera.split(' ');
  if (!valor || esquema === undefined || esquema.toLowerCase() !== ESQUEMA_SERVICIO.toLowerCase()) {
    return undefined;
  }

  return valor;
}

/** Resuelve la clave con la que verificar un token, segun quien lo emitio. */
export type ResolverClave = (emisor: string) => string | undefined;

export interface OpcionesVerificacion {
  /** Nombre de ESTE servicio. Un token dirigido a otro se rechaza. */
  destinatario: string;
  /** Clave unica compartida. Alternativa a `resolverClave`. */
  secreto?: string | undefined;
  /** Clave por emisor. Tiene precedencia sobre `secreto`. */
  resolverClave?: ResolverClave;
  /** Si se indica, solo estos emisores pueden llamar. */
  emisoresPermitidos?: string[];
  toleranciaSegundos?: number;
}

export type ResultadoServicio =
  | { valido: true; claims: ClaimsServicio }
  | { valido: false; estado: number; error: ErrorRespuesta };

const rechazo = (): ResultadoServicio => ({
  valido: false,
  estado: ESTADO_SIN_TOKEN,
  error: crearError(MENSAJE_SERVICIO_NO_AUTENTICADO),
});

/**
 * Verifica un token de servicio.
 *
 * El `iss` se lee del token SIN verificar, solo para elegir la clave; despues se
 * verifica la firma entera con esa clave. Leer un dato no verificado es seguro
 * mientras no se confie en el: aqui lo unico que decide es que clave probar, y
 * una clave equivocada hace fallar la verificacion.
 */
export function verificarTokenDeServicio(
  fuente: FuenteTokenServicio,
  opciones: OpcionesVerificacion,
): ResultadoServicio {
  const token = extraerTokenDeServicio(fuente);
  if (!token) {
    return rechazo();
  }

  const sinVerificar = jwt.decode(token) as { iss?: unknown } | null;
  const emisor = typeof sinVerificar?.iss === 'string' ? sinVerificar.iss : null;
  if (!emisor) {
    return rechazo();
  }

  if (opciones.emisoresPermitidos && !opciones.emisoresPermitidos.includes(emisor)) {
    return rechazo();
  }

  const clave = opciones.resolverClave ? opciones.resolverClave(emisor) : opciones.secreto;
  if (!clave) {
    return rechazo();
  }

  try {
    const verificado = jwt.verify(token, clave, {
      audience: opciones.destinatario,
      issuer: emisor,
      clockTolerance: opciones.toleranciaSegundos ?? TOLERANCIA_RELOJ_SEGUNDOS,
    }) as jwt.JwtPayload;

    return {
      valido: true,
      claims: {
        iss: emisor,
        aud: opciones.destinatario,
        ...(verificado.iat !== undefined ? { iat: verificado.iat } : {}),
        ...(verificado.exp !== undefined ? { exp: verificado.exp } : {}),
      },
    };
  } catch {
    return rechazo();
  }
}

// ── Adaptador para Express ───────────────────────────────────────────────────
// Los tipos son estructurales a proposito: `packages/shared` no depende de
// express, y no va a empezar a hacerlo por tres lineas de pegamento. Cualquier
// framework con la misma forma de `req`/`res` encaja.

interface PeticionMinima {
  headers: Record<string, string | string[] | undefined>;
  servicioLlamante?: ClaimsServicio;
}

interface RespuestaMinima {
  status(codigo: number): { json(cuerpo: unknown): unknown };
}

type Siguiente = () => void;

/**
 * Middleware que exige credencial de servicio.
 *
 * Deja los claims en `req.servicioLlamante`, para que el endpoint pueda
 * registrar quien le llamo sin volver a mirar la cabecera.
 */
export function exigirServicio(opciones: OpcionesVerificacion) {
  return function autenticacionDeServicio(
    req: PeticionMinima,
    res: RespuestaMinima,
    siguiente: Siguiente,
  ): unknown {
    const authorization = req.headers['authorization'];
    const resultado = verificarTokenDeServicio(
      { authorization: typeof authorization === 'string' ? authorization : undefined },
      opciones,
    );

    if (!resultado.valido) {
      return res.status(resultado.estado).json(resultado.error);
    }

    req.servicioLlamante = resultado.claims;
    return siguiente();
  };
}
