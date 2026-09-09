/**
 * Constantes del modelo de contratos.
 *
 * El catalogo de estados NO se declara aqui: vive en `packages/contracts`,
 * porque lo comparten el servicio, el frontend y el `CHECK` de la migracion.
 * Repetirlo seria crear una segunda verdad.
 */

export { ESTADOS_CONTRATO, esEstadoContrato } from 'arriendos360-contracts';
export type { EstadoContrato } from 'arriendos360-contracts';

/** Estado con el que nace un contrato. */
export const ESTADO_CONTRATO_ACTIVO = 'activo';
export const ESTADO_CONTRATO_FINALIZADO = 'finalizado';
export const ESTADO_CONTRATO_CANCELADO = 'cancelado';

/**
 * Autor de los cambios que no nacen de una peticion autenticada: las
 * migraciones y los procesos automaticos.
 *
 * Es el mismo UUID que usan ms-identidad y ms-inmuebles, a proposito:
 * identifica al sistema, no al servicio. Como las columnas de auditoria no
 * llevan clave foranea, puede apuntar a una identidad logica que no es una
 * persona.
 */
export const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';
