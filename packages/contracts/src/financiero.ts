/**
 * Contratos de interfaz de MS-Financiero.
 *
 * Fuente: Documento Principal, Capitulo 2, seccion "Contratos de interfaz" y
 * seccion Persistencia (tablas `Cuentas_cobro` y `Transacciones`).
 *
 * Desde el paso 6c este archivo deja de ser solo tipos y emite JavaScript, por
 * la misma razon que `inmuebles.ts`: los catalogos cerrados los comparten tres
 * consumidores —el modelo, que valida contra ellos; el frontend, que pinta la
 * etiqueta; y el `CHECK` de la migracion— y tenerlos en un sitio es lo unico
 * que evita que se separen en silencio.
 *
 * ── POR QUE ESTOS CATALOGOS VAN EN MAYUSCULAS ────────────────────────────────
 *
 * `TIPOS_INMUEBLE` y `ESTADOS_CONTRATO` van en minusculas, y la convencion de
 * CLAUDE.md dice que un atributo de negocio se guarda en minusculas. Los cuatro
 * catalogos de Financiero son la excepcion, y no por gusto: el Capitulo 2 fija
 * `"tipo": "INGRESO"` y `"medio_pago": "TRANSFERENCIA"` en el cuerpo de
 * `POST /api/pagos`, que es un contrato de interfaz. Bajar esos dos a minusculas
 * obligaria a traducir en el limite de la API; subir los otros dos deja las
 * cuatro columnas del servicio con el mismo aspecto. Se eligio lo segundo:
 * dentro de un servicio, la coherencia entre sus propias columnas pesa mas que
 * la coherencia con las de otro.
 */

import type { FechaHoraISO, FechaISO, MontoCOP, UUID } from './comunes';

/**
 * Estados de una cuenta de cobro.
 *
 * Catalogo CERRADO. Sustituye a los enteros 1, 2, 4 y 3 —en ese orden— que la
 * columna guardaba sin nada en la base que dijera que significaban: el mapa
 * vivia repartido entre el motor financiero, el controlador, el dashboard y un
 * `switch` del frontend, cada uno con su copia.
 *
 * `EN_MORA` no es un estado de pago sino de vencimiento, y por eso convive con
 * un saldo parcial: una cuenta abonada a medias que pasa el sexto dia sigue en
 * mora. El motor la mueve aqui y de aqui solo se sale pagandola entera.
 */
export const ESTADOS_CUENTA_COBRO = ['PENDIENTE', 'PAGADA', 'PARCIAL', 'EN_MORA'] as const;

export type EstadoCuentaCobro = (typeof ESTADOS_CUENTA_COBRO)[number];

/** Es este valor uno de los estados del catalogo? */
export const esEstadoCuentaCobro = (valor: unknown): valor is EstadoCuentaCobro =>
  typeof valor === 'string' && (ESTADOS_CUENTA_COBRO as readonly string[]).includes(valor);

/**
 * Estados de una transaccion.
 *
 * Catalogo CERRADO, y son dos porque una transaccion no se borra: se anula. El
 * dinero que entro y despues se reconocio como error tiene que seguir siendo
 * visible —el comprobante ya se emitio y alguien lo tiene impreso— y lo que
 * cambia es que deja de contar para el saldo. Ver `docs/adr/0016`.
 */
export const ESTADOS_TRANSACCION = ['CONFIRMADA', 'ANULADA'] as const;

export type EstadoTransaccion = (typeof ESTADOS_TRANSACCION)[number];

/** Es este valor uno de los estados del catalogo? */
export const esEstadoTransaccion = (valor: unknown): valor is EstadoTransaccion =>
  typeof valor === 'string' && (ESTADOS_TRANSACCION as readonly string[]).includes(valor);

/**
 * Tipo de movimiento de una transaccion.
 *
 * Catalogo CERRADO con un solo valor, que es exactamente lo que hay: hoy todo
 * movimiento del sistema es dinero que ENTRA contra una cuenta de cobro. El
 * documento solo nombra `INGRESO` y no lo sigue de un "etc.", asi que cerrarlo
 * es leer el documento, no adivinarlo.
 *
 * El dia que haya devoluciones habra que agregar `EGRESO` aqui y en el `CHECK`
 * de una migracion. Ese es el precio conocido de cerrarlo; el precio de abrirlo
 * de mas seria que la columna acumulara valores que nadie sabe interpretar,
 * que es lo que le paso a `tipo_inmueble` antes de tener catalogo.
 */
export const TIPOS_TRANSACCION = ['INGRESO'] as const;

export type TipoTransaccion = (typeof TIPOS_TRANSACCION)[number];

/** Es este valor uno de los tipos del catalogo? */
export const esTipoTransaccion = (valor: unknown): valor is TipoTransaccion =>
  typeof valor === 'string' && (TIPOS_TRANSACCION as readonly string[]).includes(valor);

/**
 * Medio por el que se recibio el dinero.
 *
 * ABIERTO, y es el unico de los cuatro que lo es. El documento ejemplifica
 * `TRANSFERENCIA` sin cerrar la lista, y la columna que lo hereda
 * —`abonos.tipo_transaccion`— ya guarda texto libre puesto por el desplegable
 * de la SPA: "Transferencia Bancaria", "Efectivo", "Consignacion". Un `CHECK`
 * aqui habria hecho fallar la migracion contra los datos que ya existen.
 *
 * Los valores de `MEDIOS_PAGO_CONOCIDOS` son una SUGERENCIA para el
 * desplegable, no un catalogo: nada valida contra ellos.
 */
export type MedioPago = 'TRANSFERENCIA' | (string & {});

/** Lo que ofrece el desplegable. No se valida contra esta lista. */
export const MEDIOS_PAGO_CONOCIDOS = [
  'Transferencia Bancaria',
  'Efectivo',
  'Consignacion',
] as const;

/**
 * Cuerpo de `POST /api/pagos`.
 *
 * Este contrato deja explicita la separacion que el modelo anterior mezclaba:
 * una `Cuenta_cobro` es la factura mensual que el sistema genera; una
 * `Transaccion` es el movimiento de dinero contra esa factura. Por eso el cuerpo
 * referencia `id_cuenta_cobro` y no un "id_pago".
 *
 * `id_cuenta_cobro` es una referencia interna de MS-Financiero, no cruza
 * frontera de servicio.
 *
 * `fecha_pago` es opcional en la peticion aunque el documento la liste: si no
 * viene, se toma el momento del registro, que es lo que hacia el endpoint al que
 * sustituye. Un formulario que no pregunta la fecha no puede quedar bloqueado
 * por un campo que el documento describe para el caso en que si se conozca.
 */
export interface RegistrarPagoRequest {
  id_cuenta_cobro: UUID;
  monto: MontoCOP;
  tipo: TipoTransaccion;
  medio_pago: MedioPago;
  fecha_pago?: FechaHoraISO;
  /** Referencia del movimiento, para el comprobante. Ver `docs/adr/0015`. */
  observaciones?: string;
}

/**
 * Cuerpo de `POST /api/pagos/cuentas-cobro`.
 *
 * Alta manual de una cuenta de cobro. El camino normal es que las genere el
 * motor a partir del contrato; esto existe para la demostracion y para corregir
 * a mano, y por eso `inicio` y `fin` se pueden omitir: se derivan del periodo de
 * corte del contrato igual que los del motor.
 */
export interface CrearCuentaCobroRequest {
  id_contrato: UUID;
  valor: MontoCOP;
  inicio?: FechaISO;
  fin?: FechaISO;
  detalle?: string;
}
