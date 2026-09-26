/** Constantes del modelo de inmuebles. Los catálogos vienen de `packages/contracts`. */

export {
  ESTADOS_INMUEBLE,
  TIPOS_INMUEBLE,
  esEstadoInmueble,
  esTipoInmueble,
} from 'arriendos360-contracts';
export type { EstadoInmueble, TipoInmueble } from 'arriendos360-contracts';

/** Estado con el que nace un inmueble. */
export const ESTADO_INICIAL = 'disponible';

/** Autor de los cambios que no hace una persona. Mismo UUID en todos los servicios. */
export const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';
