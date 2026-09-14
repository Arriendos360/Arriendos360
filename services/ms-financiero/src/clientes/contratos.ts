/**
 * Cliente de MS-Financiero hacia MS-Contratos.
 *
 * Es el cliente central de este servicio. `cuentas_cobro` cuelga de un contrato
 * que ya no esta en esta base, asi que casi todo lo que el servicio hace pasa
 * por aqui:
 *
 *   - filtrar las cuentas de cobro y las transacciones de quien pregunta,
 *   - autorizar una emision o una anulacion («¿es suyo este contrato?»),
 *   - pintar el inmueble y el arrendatario en el listado y en los PDF,
 *   - recorrer los contratos activos en cada barrido del motor.
 *
 * Todas eran `JOIN` hasta el paso 6d y `include` locales hasta el 6e. La regla
 * dura 2 los prohibe entre servicios, asi que se piden por HTTP.
 *
 * ── LA DIRECCION ES CORRECTA ────────────────────────────────────────────────
 *
 * Financiero y Contratos son los dos subdominios **Core**. Que uno consulte al
 * otro no invierte ninguna dependencia; lo que no valdria es que Contratos
 * preguntara por cuentas de cobro, y no lo hace: emite un evento y se olvida.
 *
 * ── DOS USOS, DOS POLITICAS DE FALLO ────────────────────────────────────────
 *
 * Es la misma distincion que traia el cliente del gateway, y aqui vuelve a
 * decidir lo que pasa cuando el servicio no responde:
 *
 * **Autorizar** — «¿que contratos son de este usuario?», «¿este contrato es
 * suyo?». Un fallo NO se degrada: devolver una lista vacia haria que un
 * propietario viera «no tienes cobros» en vez de un error, que es una respuesta
 * creible y falsa. `contratosDondeEsParte`, `contratosDePropietario`,
 * `contratosConEstado`, `propioDe` y `parteDe` PROPAGAN.
 *
 * **Decorar** — «dame estos contratos» para pintar un listado o un PDF. Aqui si
 * se degrada: `porIds` devuelve un mapa vacio y el consumidor pinta lo que
 * pueda. Un recibo sin la direccion sigue siendo un recibo; un 502 al pedirlo,
 * no.
 *
 * ── EL INMUEBLE VIENE DENTRO, Y ESO AHORRA UN SALTO ─────────────────────────
 *
 * `incluir=inmueble` hace que ms-contratos adjunte el `Inmueble` de cada
 * contrato antes de responder. Es lo que necesitan el motor y los comprobantes,
 * y pedirlo asi en vez de preguntarle despues a ms-inmuebles tiene tres razones:
 *
 *   1. Este servicio no tiene por que saber que un contrato tiene inmueble ni
 *      donde vive ese dato. Pregunta por lo que necesita y lo recibe entero.
 *   2. Son DOS saltos encadenados —hasta que Contratos no dice de que inmueble
 *      es cada contrato, no se sabe que inmuebles pedir— y encadenarlos desde
 *      aqui costaria dos viajes de red en vez de uno.
 *   3. Contratos ya sabe hacerlo en lote para su propia respuesta de
 *      `/api/contratos`. Es la misma funcion, no una segunda copia de la regla.
 *
 * La garantia de UN VIAJE POR BARRIDO se conserva: `contratosConEstado` y
 * `porIds` traen la lista entera con sus inmuebles dentro, en una peticion, haya
 * cinco contratos o quinientos.
 */

import { cabeceraDeServicio, enteroDeEntorno, textoDeEntorno } from 'arriendos360-shared';

const TIEMPO_LIMITE_MS = enteroDeEntorno('MS_CONTRATOS_TIMEOUT_MS', 3000);

const DESTINATARIO = 'ms-contratos';

/** Lo que este servicio mira de un inmueble ajeno. */
export interface InmuebleAjeno {
  id_inmueble: string;
  id_propietario: string;
  direccion?: string;
  barrio?: string;
  municipio?: string;
  tipo?: string;
  [clave: string]: unknown;
}

/** Lo que este servicio mira de un contrato ajeno. */
export interface ContratoAjeno {
  id_contrato: string;
  id_inmueble: string;
  id_inquilino: string;
  canon: number | string;
  fecha_inicio_corte: string;
  estado: string;
  /** Presente solo si se pidio con `incluir=inmueble`. */
  Inmueble?: InmuebleAjeno | null;
  [clave: string]: unknown;
}

/** URL base del servicio, o null si todavia no esta configurado. */
export const urlBase = (entorno: NodeJS.ProcessEnv = process.env): string | null => {
  const valor = entorno['MS_CONTRATOS_URL'];
  if (typeof valor !== 'string') {
    return null;
  }

  const limpio = valor.trim();
  return limpio === '' ? null : limpio.replace(/\/+$/, '');
};

/** GET a `/interno` con credencial de servicio. Todo lo de aqui son consultas. */
const pedirJson = async (url: string): Promise<{ contratos?: ContratoAjeno[]; contrato?: ContratoAjeno } | null> => {
  const respuesta = await fetch(url, {
    headers: cabeceraDeServicio({
      emisor: textoDeEntorno('SERVICIO_NOMBRE', 'ms-financiero'),
      destinatario: DESTINATARIO,
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
  });

  if (respuesta.status === 404) {
    return null;
  }

  if (!respuesta.ok) {
    throw new Error(`ms-contratos respondió ${respuesta.status} a ${url}`);
  }

  return (await respuesta.json()) as { contratos?: ContratoAjeno[]; contrato?: ContratoAjeno };
};

export interface OpcionesConsulta {
  urlBase?: string | null;
  /** Pide que cada contrato venga con su `Inmueble` dentro. */
  conInmueble?: boolean;
}

/** Consulta con filtros y devuelve la lista. PROPAGA el fallo. */
const consultar = async (query: string, opciones: OpcionesConsulta = {}): Promise<ContratoAjeno[]> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null) {
    return [];
  }

  const con = opciones.conInmueble ? '&incluir=inmueble' : '';
  const datos = await pedirJson(`${base}/interno/contratos?${query}${con}`);
  return datos?.contratos ?? [];
};

/**
 * Los contratos en los que el usuario es PARTE: dueño del inmueble o inquilino.
 *
 * Es la disyuncion completa del proyecto, resuelta de una vez por el servicio
 * que tiene los datos. Sustituye al `Op.or` sobre columnas alcanzadas por
 * `include` que CLAUDE.md tuvo anotado como decision abierta hasta el paso 6d.
 *
 * @throws si ms-contratos no responde. Ver la nota de cabecera.
 */
export const contratosDondeEsParte = (
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno[]> => consultar(`parte=${encodeURIComponent(sub)}`, opciones);

/**
 * Solo los identificadores. Es lo que se pasa como
 * `id_contrato: { [Op.in]: ids }` allí donde antes habia un `include` con un
 * `where` sobre el contrato.
 */
export const idsDondeEsParte = async (
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<string[]> =>
  (await contratosDondeEsParte(sub, opciones)).map((contrato) => contrato.id_contrato);

/**
 * Los contratos sobre los inmuebles de un propietario.
 *
 * La mitad de propietario de la disyuncion. La usa `verificar-mora`, que
 * escribe y por tanto no puede conformarse con «ser parte».
 *
 * @throws si ms-contratos no responde.
 */
export const contratosDePropietario = (
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno[]> => consultar(`propietario=${encodeURIComponent(sub)}`, opciones);

/**
 * Los contratos con un estado dado, de todo el sistema.
 *
 * Es el barrido del motor, que no tiene sujeto: recorre los activos para generar
 * las cuentas de cobro del mes. UNA peticion por barrido, no una por contrato.
 *
 * @throws si ms-contratos no responde. El motor lo registra y no genera nada ese
 *   ciclo, que es mejor que generar la mitad.
 */
export const contratosConEstado = (
  estado: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno[]> => consultar(`estado=${encodeURIComponent(estado)}`, opciones);

/**
 * Datos de varios contratos, indexados por id.
 *
 * EN LOTE a proposito: un listado de veinte cuentas de cobro pediria veinte
 * veces lo mismo si la consulta fuera de una en una — el N+1 de siempre, pero
 * con latencia de red.
 *
 * DEGRADA a un mapa vacio: esto es decorar, no autorizar.
 */
export const porIds = async (
  ids: Array<string | null | undefined>,
  opciones: OpcionesConsulta = {},
): Promise<Map<string, ContratoAjeno>> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];

  if (base === null || unicos.length === 0) {
    return new Map();
  }

  try {
    const con = opciones.conInmueble ? '&incluir=inmueble' : '';
    const datos = await pedirJson(
      `${base}/interno/contratos?ids=${encodeURIComponent(unicos.join(','))}${con}`,
    );

    return new Map((datos?.contratos ?? []).map((contrato) => [contrato.id_contrato, contrato]));
  } catch (error) {
    // Se registra pero no se propaga: esto es decorar, no autorizar.
    console.error(
      '⚠️  ms-financiero: no se pudieron obtener contratos de ms-contratos:',
      (error as Error).message,
    );
    return new Map();
  }
};

/** Un contrato, o null. Azucar sobre `porIds`. DEGRADA. */
export const porId = async (
  id: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno | null> => {
  const mapa = await porIds([id], opciones);
  return mapa.get(id) ?? null;
};

/**
 * Un contrato, SOLO si es sobre un inmueble de este propietario. `null` si no.
 *
 * Dos preguntas en un solo salto: el contrato esta en ms-contratos y el dueño de
 * su inmueble en ms-inmuebles, y quien las cruza es ms-contratos. Este servicio
 * no necesita saber que un contrato tiene inmueble. Ver `docs/adr/0017`.
 *
 * PROPAGA el fallo, como todo lo que autoriza.
 */
export const propioDe = async (
  idContrato: string,
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno | null> => {
  const base = opciones.urlBase !== undefined ? opciones.urlBase : urlBase();

  if (base === null || !idContrato) {
    return null;
  }

  const datos = await pedirJson(
    `${base}/interno/contratos/${encodeURIComponent(idContrato)}` +
      `?propietario=${encodeURIComponent(sub)}`,
  );

  return datos?.contrato ?? null;
};

/**
 * El contrato si el usuario es parte de el, por cualquiera de las dos vias.
 *
 * Se resuelve con la lista de `contratosDondeEsParte` en vez de con un endpoint
 * propio: el llamante casi siempre necesita despues la lista entera —para
 * filtrar sus cuentas de cobro— asi que pedirla una vez es mas barato que pedir
 * el contrato y despues la lista.
 *
 * PROPAGA el fallo.
 */
export const parteDe = async (
  idContrato: string,
  sub: string,
  opciones: OpcionesConsulta = {},
): Promise<ContratoAjeno | null> => {
  const contratos = await contratosDondeEsParte(sub, opciones);
  return contratos.find((contrato) => contrato.id_contrato === idContrato) ?? null;
};
