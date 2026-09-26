/** Constantes del modelo de contratos. El catálogo de estados viene de `packages/contracts`. */

export { ESTADOS_CONTRATO, esEstadoContrato } from 'arriendos360-contracts';
export type { EstadoContrato } from 'arriendos360-contracts';

/** Estado con el que nace un contrato. */
export const ESTADO_CONTRATO_ACTIVO = 'activo';
export const ESTADO_CONTRATO_FINALIZADO = 'finalizado';
export const ESTADO_CONTRATO_CANCELADO = 'cancelado';

/** Autor de los cambios que no hace una persona. Mismo UUID en todos los servicios. */
export const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';
