/** Contratos de interfaz de MS-Contratos. */

import type { DiaDelMes, FechaISO, MontoCOP, UUID } from './comunes';

/** Estados de un contrato. Catálogo cerrado, espejo del `CHECK` de la migración. */
export const ESTADOS_CONTRATO = ['activo', 'finalizado', 'cancelado'] as const;

export type EstadoContrato = (typeof ESTADOS_CONTRATO)[number];

/** Es este valor uno de los estados del catalogo? */
export const esEstadoContrato = (valor: unknown): valor is EstadoContrato =>
  typeof valor === 'string' && (ESTADOS_CONTRATO as readonly string[]).includes(valor);

/**
 * Cuerpo de `POST /api/contratos`. `id_inmueble` e `id_inquilino` son referencias
 * a otros servicios, sin clave foránea.
 */
export interface CrearContratoRequest {
  id_inmueble: UUID;
  id_inquilino: UUID;
  inicio: FechaISO;
  fin: FechaISO;
  /** Primera fecha de corte. Si no viene, se deriva de `inicio`. */
  fecha_inicio_corte?: FechaISO;
  /** Día del mes (1-31) en que vence el pago. Si no viene, se deriva de `inicio`. */
  fecha_limite_pago?: DiaDelMes;
  canon: MontoCOP;
  /** Deudor solidario, opcional. */
  nombre_deudor_solidario?: string;
  documento_deudor_solidario?: string;
  /** Texto libre con las condiciones particulares. Opcional. */
  info_contrato?: string;
}

/** Tipos de anexo sugeridos en el formulario. Catálogo abierto: nada valida contra él. */
export const TIPOS_ANEXO_CONOCIDOS = ['CONTRATO_FIRMADO', 'OTROSI'] as const;

/** Tipo de anexo: sugiere los conocidos sin cerrar el tipo. */
export type TipoAnexo = (typeof TIPOS_ANEXO_CONOCIDOS)[number] | (string & {});

/** Tope de tamaño por anexo, en megabytes. */
export const TAMANO_MAXIMO_ANEXO_MB = 10;

/**
 * Campos del `multipart/form-data` de `POST /api/contratos/{id_contrato}/anexos`.
 * `file` es `unknown` porque su forma depende del entorno.
 */
export interface CrearAnexoFormData {
  file: unknown;
  tipo: TipoAnexo;
}
