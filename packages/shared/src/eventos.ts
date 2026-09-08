/**
 * Tipos de evento del bus.
 *
 * CLAUDE.md los ubica aqui —«Los tipos de evento viven en packages/shared»— y
 * el motivo no es la comodidad: un evento es un contrato entre dos servicios
 * que no se llaman, y por tanto no hay ninguna peticion HTTP cuyo fallo revele
 * que se han separado. Si el productor y el consumidor declararan cada uno su
 * propia forma del evento, la divergencia solo se veria en produccion y en
 * forma de dato que no llega.
 *
 * EL SOBRE Y LA CARGA SON COSAS DISTINTAS. `SobreEvento` es infraestructura:
 * identificador, tipo, version, momento de ocurrencia. Lo entiende el
 * publicador y lo entiende el consumidor, y ninguno de los dos necesita saber
 * que hay dentro. La carga es dominio, y cada tipo tiene la suya.
 *
 * LA VERSION VA DESDE EL PRIMER EVENTO. Hoy todos son `1` y no aporta nada;
 * ponerla despues, cuando aporte, exige que el consumidor trate como version 1
 * los eventos que no la traen —es decir, exige exactamente el codigo que se
 * queria ahorrar, mas la duda de si un sobre sin version es viejo o esta roto.
 * Cuesta un campo ahora y evita una migracion de datos historicos luego.
 */

import crypto from 'crypto';

/** Nombre de cada tipo. Como constante para que un typo no compile. */
export const TIPO_CONTRATO_FORMALIZADO = 'ContratoFormalizado';
export const TIPO_CONTRATO_FINALIZADO = 'ContratoFinalizado';

/**
 * `ContratoFormalizado` — se firmo un contrato sobre un inmueble.
 *
 * Fuente: Capitulo 2, seccion Comunicacion entre servicios. El documento lo
 * describe como el disparador de la creacion en cadena: MS-Contratos lo emite,
 * MS-Financiero lo consume y crea la primera cuenta de cobro.
 *
 * `canon` y `fecha_inicio_corte` viajan aunque hoy no los use nadie: son
 * exactamente lo que MS-Financiero necesitara en el paso 6, y el emisor es el
 * unico que los tiene a mano en el momento de emitir. Pedirlos despues por HTTP
 * convertiria la coreografia en una orquestacion disfrazada.
 */
export interface ContratoFormalizado {
  id_contrato: string;
  id_inmueble: string;
  /** Pesos colombianos. Viaja como numero, no como texto formateado. */
  canon: number;
  /** `YYYY-MM-DD`. Primera fecha de corte del ciclo de facturacion. */
  fecha_inicio_corte: string;
}

/**
 * `ContratoFinalizado` — un contrato dejo de estar vigente.
 *
 * NO esta en el Capitulo 2. El documento da un ejemplo de la comunicacion
 * asincrona, no la lista cerrada de eventos del sistema; usar un evento para
 * ocupar el inmueble y una llamada sincrona para liberarlo dejaria la mitad del
 * ciclo de vida con garantia de entrega y la otra mitad sin ella. Ver
 * `docs/adr/0013`.
 *
 * Lleva `id_inmueble` y no solo `id_contrato` a proposito: el consumidor tiene
 * que poder actuar sin volver a preguntar. Un evento que obliga a llamar al
 * emisor para entenderse no desacopla nada.
 */
export interface ContratoFinalizado {
  id_contrato: string;
  id_inmueble: string;
}

/** Carga que corresponde a cada tipo. Es lo que ata el nombre con su forma. */
export interface CargaPorTipo {
  [TIPO_CONTRATO_FORMALIZADO]: ContratoFormalizado;
  [TIPO_CONTRATO_FINALIZADO]: ContratoFinalizado;
}

export type TipoEvento = keyof CargaPorTipo;

/**
 * El sobre: lo que se guarda en la tabla de salida y lo que viaja por la red.
 *
 * `id_evento` es la pieza sobre la que descansa todo el mecanismo. La entrega
 * es al-menos-una-vez, asi que el consumidor recibira repetidos; sin un
 * identificador estable del EVENTO —no de la entrega— no hay forma de
 * distinguir «me lo mandaron dos veces» de «pasaron dos cosas iguales».
 */
export interface SobreEvento<T extends TipoEvento = TipoEvento> {
  id_evento: string;
  tipo: T;
  version: number;
  /** ISO 8601 en UTC. Cuando OCURRIO el hecho, no cuando se entrego. */
  ocurrido_en: string;
  payload: CargaPorTipo[T];
}

/**
 * El sobre tal como lo ve la INFRAESTRUCTURA: con la carga opaca.
 *
 * El publicador, el transporte y el consumidor mueven sobres sin abrirlos, y
 * ademas manejan tipos que este paquete quiza ya no conozca —un evento viejo
 * que sigue en la tabla de salida despues de un despliegue. Por eso `tipo` es
 * `string` y `payload` es `unknown`: quien tiene que entender la carga es el
 * manejador, que es el unico que sabe que espera.
 */
export interface SobreOpaco {
  id_evento: string;
  tipo: string;
  version: number;
  ocurrido_en: string;
  payload: unknown;
}

/** Alias historico de {@link SobreOpaco}. */
export type SobreDesconocido = SobreOpaco;

/** Version vigente de cada tipo. Sube cuando cambia la forma de su carga. */
export const VERSION_EVENTO: Record<TipoEvento, number> = {
  [TIPO_CONTRATO_FORMALIZADO]: 1,
  [TIPO_CONTRATO_FINALIZADO]: 1,
};

/**
 * Mete una carga en su sobre.
 *
 * El `id_evento` se genera aqui, en la aplicacion, por la misma razon que los
 * UUID de las tablas: el emisor tiene que conocerlo antes de que la fila
 * exista, porque lo escribe DENTRO de su transaccion de dominio.
 */
export function crearSobre<T extends TipoEvento>(
  tipo: T,
  payload: CargaPorTipo[T],
  opciones: { id_evento?: string; ocurrido_en?: Date } = {},
): SobreEvento<T> {
  return {
    id_evento: opciones.id_evento ?? crypto.randomUUID(),
    tipo,
    version: VERSION_EVENTO[tipo],
    ocurrido_en: (opciones.ocurrido_en ?? new Date()).toISOString(),
    payload,
  };
}

/**
 * Valida la forma del sobre que llega por la red.
 *
 * Confianza cero tambien aqui: el que entrega es otro servicio, pero eso ya no
 * hace confiable lo que manda (regla dura 7). Se comprueba la estructura, no la
 * carga: de la carga responde el manejador, que es quien sabe que espera.
 */
export function esSobreEvento(valor: unknown): valor is SobreOpaco {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }

  const sobre = valor as Record<string, unknown>;

  return (
    typeof sobre['id_evento'] === 'string' &&
    sobre['id_evento'].length > 0 &&
    typeof sobre['tipo'] === 'string' &&
    sobre['tipo'].length > 0 &&
    typeof sobre['version'] === 'number' &&
    typeof sobre['ocurrido_en'] === 'string' &&
    typeof sobre['payload'] === 'object' &&
    sobre['payload'] !== null
  );
}
