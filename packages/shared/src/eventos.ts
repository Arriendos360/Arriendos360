/** Tipos de evento del bus: el sobre común y la carga de cada tipo. */

import crypto from 'crypto';

/** Nombre de cada tipo. Como constante para que un typo no compile. */
export const TIPO_CONTRATO_FORMALIZADO = 'ContratoFormalizado';
export const TIPO_CONTRATO_FINALIZADO = 'ContratoFinalizado';

// Avisos a personas: los consume ms-notificaciones.
export const TIPO_RECUPERACION_SOLICITADA = 'RecuperacionSolicitada';
export const TIPO_CONTRASENA_TEMPORAL_EMITIDA = 'ContrasenaTemporalEmitida';
export const TIPO_CUENTA_COBRO_GENERADA = 'CuentaCobroGenerada';
export const TIPO_CUENTA_COBRO_POR_VENCER = 'CuentaCobroPorVencer';
export const TIPO_CUENTA_COBRO_EN_MORA = 'CuentaCobroEnMora';

/*
 * Ningún evento lleva una dirección de correo: llevan `id_usuario` y
 * ms-notificaciones resuelve el destinatario al manejarlo.
 */

/** Se firmó un contrato. v2 añade `id_inquilino`, opcional para aceptar sobres v1. */
export interface ContratoFormalizado {
  id_contrato: string;
  id_inmueble: string;
  /** Pesos colombianos. Viaja como numero, no como texto formateado. */
  canon: number;
  /** `YYYY-MM-DD`. Primera fecha de corte del ciclo de facturacion. */
  fecha_inicio_corte: string;
  /** Versión 2. Sin él, la cuenta de cobro se crea sin notificar. */
  id_inquilino?: string;
}

/** Un contrato dejó de estar vigente. */
export interface ContratoFinalizado {
  id_contrato: string;
  id_inmueble: string;
}

/**
 * Alguien pidió restablecer su contraseña. El token viaja en claro: el payload se
 * borra al marcar la entrega (`tiposRedactados` en `salida.ts`).
 */
export interface RecuperacionSolicitada {
  id_usuario: string;
  /** El token en claro. */
  token: string;
  /** ISO 8601 en UTC. Cuando deja de valer el enlace. */
  expira_en: string;
}

/** Se creó o reemitió un acceso. Avisa que la cuenta existe; no lleva la contraseña. */
export interface ContrasenaTemporalEmitida {
  id_usuario: string;
  /** `ALTA` la creo; `REEMISION` la regenero. Cambia el texto, no el canal. */
  motivo: 'ALTA' | 'REEMISION';
}

/** Se emitió una cuenta de cobro, por cualquiera de los caminos que la crean. */
export interface CuentaCobroGenerada {
  id_cuenta_cobro: string;
  id_contrato: string;
  /** A quien se le factura. El destinatario del aviso. */
  id_inquilino: string;
  /** Pesos colombianos, como numero. */
  valor: number;
  /** El periodo facturado, `YYYY-MM-DD`. Ver `periodoDeCorte()`. */
  inicio: string;
  fin: string;
}

/** A una cuenta pendiente se le acaba el plazo. Avisa al inquilino y al propietario. */
export interface CuentaCobroPorVencer {
  id_cuenta_cobro: string;
  id_contrato: string;
  id_inquilino: string;
  /** Dueño del inmueble en el momento del hecho. */
  id_propietario: string;
  valor: number;
  inicio: string;
  fin: string;
  /** `YYYY-MM-DD`. El dia en que la cuenta pasaria a EN_MORA. */
  entra_en_mora_el: string;
  direccion_inmueble: string;
}

/** Una cuenta entró en mora. Avisa al inquilino y al propietario. */
export interface CuentaCobroEnMora {
  id_cuenta_cobro: string;
  id_contrato: string;
  id_inquilino: string;
  id_propietario: string;
  valor: number;
  inicio: string;
  fin: string;
  /** Dias de calendario en `America/Bogota` desde el corte. */
  dias_de_mora: number;
  direccion_inmueble: string;
}

/** Carga que corresponde a cada tipo. Es lo que ata el nombre con su forma. */
export interface CargaPorTipo {
  [TIPO_CONTRATO_FORMALIZADO]: ContratoFormalizado;
  [TIPO_CONTRATO_FINALIZADO]: ContratoFinalizado;
  [TIPO_RECUPERACION_SOLICITADA]: RecuperacionSolicitada;
  [TIPO_CONTRASENA_TEMPORAL_EMITIDA]: ContrasenaTemporalEmitida;
  [TIPO_CUENTA_COBRO_GENERADA]: CuentaCobroGenerada;
  [TIPO_CUENTA_COBRO_POR_VENCER]: CuentaCobroPorVencer;
  [TIPO_CUENTA_COBRO_EN_MORA]: CuentaCobroEnMora;
}

export type TipoEvento = keyof CargaPorTipo;

/**
 * El sobre: lo que se guarda en la tabla de salida y viaja por la red. El
 * consumidor descarta repetidos por `id_evento`.
 */
export interface SobreEvento<T extends TipoEvento = TipoEvento> {
  id_evento: string;
  tipo: T;
  version: number;
  /** ISO 8601 en UTC. Cuando OCURRIO el hecho, no cuando se entrego. */
  ocurrido_en: string;
  payload: CargaPorTipo[T];
}

/** El sobre con la carga opaca, como lo mueven el publicador y el consumidor. */
export interface SobreOpaco {
  id_evento: string;
  tipo: string;
  version: number;
  ocurrido_en: string;
  payload: unknown;
}

/** Alias de {@link SobreOpaco}. */
export type SobreDesconocido = SobreOpaco;

/** Versión vigente de cada tipo. Sube cuando cambia la forma de su carga. */
export const VERSION_EVENTO: Record<TipoEvento, number> = {
  [TIPO_CONTRATO_FORMALIZADO]: 2,
  [TIPO_CONTRATO_FINALIZADO]: 1,
  [TIPO_RECUPERACION_SOLICITADA]: 1,
  [TIPO_CONTRASENA_TEMPORAL_EMITIDA]: 1,
  [TIPO_CUENTA_COBRO_GENERADA]: 1,
  [TIPO_CUENTA_COBRO_POR_VENCER]: 1,
  [TIPO_CUENTA_COBRO_EN_MORA]: 1,
};

/** Mete una carga en su sobre, con un `id_evento` nuevo si no se da uno. */
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

/** Espacio de nombres de los identificadores deterministas. No se cambia. */
export const ESPACIO_EVENTOS = '5d0b1f0e-8c1a-4a63-9a8e-3a1e0b6f2c47';

/**
 * `id_evento` determinista (UUID v5 de `tipo` y `partes`), para que un aviso sin
 * cambio de dominio no se anote dos veces si el proceso se reintenta.
 */
export function idDeEventoDeterminista(tipo: TipoEvento, ...partes: string[]): string {
  const espacio = Buffer.from(ESPACIO_EVENTOS.replace(/-/g, ''), 'hex');
  const hash = crypto
    .createHash('sha1')
    .update(espacio)
    .update([tipo, ...partes].join('|'))
    .digest();

  // Version 5 y variante RFC 4122, para que sea un UUID valido para la columna.
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;

  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Valida la estructura del sobre que llega por la red; la carga la valida el manejador. */
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
