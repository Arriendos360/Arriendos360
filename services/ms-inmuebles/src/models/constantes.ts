/**
 * Constantes del modelo de inmuebles.
 *
 * El catalogo de tipos y estados NO se declara aqui: vive en
 * `packages/contracts`, porque lo comparten el servicio, el frontend y la
 * migracion. Repetirlo seria crear una segunda verdad.
 */

export {
  ESTADOS_INMUEBLE,
  TIPOS_INMUEBLE,
  esEstadoInmueble,
  esTipoInmueble,
} from 'arriendos360-contracts';
export type { EstadoInmueble, TipoInmueble } from 'arriendos360-contracts';

/** Estado con el que nace un inmueble: nadie lo ha arrendado todavia. */
export const ESTADO_INICIAL = 'disponible';

/**
 * Autor de los cambios que no nacen de una peticion autenticada: las
 * migraciones y los procesos automaticos.
 *
 * Es el mismo UUID que usa ms-identidad, a proposito: identifica al sistema, no
 * al servicio. Como las columnas de auditoria no llevan clave foranea, puede
 * apuntar a una identidad logica que no es una persona.
 */
export const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';
