/**
 * Constantes del modelo financiero.
 *
 * Los catalogos NO se declaran aqui: viven en `packages/contracts`, porque los
 * comparten el servicio, el frontend y el `CHECK` de la migracion. Repetirlos
 * seria crear una segunda verdad. Lo que hay aqui son NOMBRES para sus valores,
 * de modo que los `where` del motor, del controlador y del `/interno` no
 * repartan literales sueltos por el codigo — que es exactamente lo que pasaba
 * con los enteros 1, 2, 3 y 4 que el paso 6c sustituyo.
 *
 * OJO al orden en que traducian: 4 era PARCIAL y 3 era EN_MORA, no al reves.
 */

export {
  ESTADOS_CUENTA_COBRO,
  ESTADOS_TRANSACCION,
  TIPOS_TRANSACCION,
  esEstadoCuentaCobro,
  esEstadoTransaccion,
  esTipoTransaccion,
} from 'arriendos360-contracts';
export type {
  EstadoCuentaCobro,
  EstadoTransaccion,
  MedioPago,
  TipoTransaccion,
} from 'arriendos360-contracts';

export const ESTADO_CUENTA_PENDIENTE = 'PENDIENTE';
export const ESTADO_CUENTA_PAGADA = 'PAGADA';
export const ESTADO_CUENTA_PARCIAL = 'PARCIAL';
export const ESTADO_CUENTA_EN_MORA = 'EN_MORA';

export const ESTADO_TRANSACCION_CONFIRMADA = 'CONFIRMADA';
export const ESTADO_TRANSACCION_ANULADA = 'ANULADA';

/** Hoy todo movimiento del sistema es dinero que entra. */
export const TIPO_TRANSACCION_INGRESO = 'INGRESO';

/**
 * Estados de un contrato.
 *
 * El contrato es de OTRO servicio y este no guarda ninguno; el nombre hace falta
 * igualmente porque el motor le pide a ms-contratos «los activos» y el guardia
 * de ningun sitio deberia escribir `'activo'` a mano.
 */
export const ESTADO_CONTRATO_ACTIVO = 'activo';

/**
 * Autor de los cambios que no origina una persona: el motor financiero cuando
 * genera cuentas de cobro a medianoche, y el consumidor del bus cuando crea la
 * primera al enterarse de que se firmo un contrato.
 *
 * Es el mismo UUID que usan los demas servicios, a proposito: identifica al
 * sistema, no al servicio. Como las columnas de auditoria no llevan clave
 * foranea, puede apuntar a una identidad logica que no es una persona.
 *
 * Que la primera cuenta de cobro quede a nombre del sistema y no del propietario
 * que firmo NO rompe el rastro, lo cambia de forma: el sobre del evento no lleva
 * actor, y quien firmo esta registrado donde corresponde, en
 * `contratos.contratos.creado_por`. La cadena completa esta en `docs/adr/0011`.
 */
export const USUARIO_SISTEMA = '6facbaff-9fcd-4300-9426-e464f45be52d';
