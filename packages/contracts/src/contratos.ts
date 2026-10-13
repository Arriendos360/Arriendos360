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

/**
 * IPC anual de Colombia en porcentaje (variación de diciembre a diciembre, DANE). Es el tope
 * del reajuste del canon (Ley 820 de 2003, art. 20). Cada enero se agrega el año anterior.
 */
export const IPC_ANUAL: Readonly<Record<number, number>> = {
  2020: 1.61,
  2021: 5.62,
  2022: 13.12,
  2023: 9.28,
  2024: 5.2,
  2025: 5.1,
};

/** Meses de anticipación del preaviso de no renovar (Ley 820 de 2003, arts. 22 num. 8 y 24 num. 5). */
export const MESES_PREAVISO_TERMINACION = 3;

/** Días antes de la fecha límite del preaviso en que se recuerda a las dos partes. */
export const DIAS_RECORDATORIO_PREAVISO = 30;

/** Años de ejecución que exige la causal de plena voluntad del arrendador. */
export const ANIOS_PLENA_VOLUNTAD = 4;

/** Una de las dos partes de un contrato, por el rol con que actúa en él. */
export type ParteContrato = 'PROPIETARIO' | 'INQUILINO';

/** Quién envía el preaviso. */
export type PartePreaviso = ParteContrato;

/** El fundamento legal del preaviso según quién lo envía. */
export const FUNDAMENTO_PREAVISO: Readonly<Record<PartePreaviso, string>> = {
  PROPIETARIO: 'artículo 22, numeral 8, de la Ley 820 de 2003',
  INQUILINO: 'artículo 24, numeral 5, de la Ley 820 de 2003',
};

/**
 * Causales del arrendador para no renovar (Ley 820 de 2003, art. 22 num. 8), con su etiqueta
 * legal. Catálogo cerrado, espejo del `CHECK` de la migración.
 */
export const CAUSALES_PREAVISO_ARRENDADOR = {
  ocupacion_propia: 'Ocupar el inmueble para su propia habitación por no menos de un año (literal a)',
  demolicion: 'Demoler el inmueble para efectuar una nueva construcción (literal b)',
  reparaciones: 'Desocuparlo para ejecutar obras independientes para su reparación (literal b)',
  compraventa: 'Entregarlo en cumplimiento de un contrato de compraventa (literal c)',
  plena_voluntad:
    'Plena voluntad, con cuatro años de ejecución del contrato y una indemnización de 1,5 cánones (literal d)',
} as const;

export type CausalPreaviso = keyof typeof CAUSALES_PREAVISO_ARRENDADOR;

/** Lo que se puede cambiar de un contrato activo: nunca sus partes, su inicio, su corte ni su estado. */
export const CAMPOS_CONTRATO_EDITABLES = [
  'fin',
  'fecha_limite_pago',
  'canon',
  'info_contrato',
  'nombre_deudor_solidario',
  'documento_deudor_solidario',
] as const;

/** Cómo se presenta un contrato activo: la prórroga y el vencimiento se deducen de las fechas. */
export type SituacionContrato = 'vigente' | 'renovado' | 'vencido_con_preaviso';

export interface MotivoCancelacion {
  etiqueta: string;
  referencia: string;
  /** Indemnización sugerida, en cánones. Es pactable: se sugiere, no se impone. */
  canones_sugeridos: number;
  a_cargo_de: ParteContrato | null;
  /** Sólo se admite con el contrato prorrogado (`renovado`). */
  solo_en_prorroga: boolean;
}

/**
 * Motivos para terminar un contrato antes de tiempo (Ley 820 de 2003, arts. 21, 22 y 24).
 * Catálogo cerrado, espejo del `CHECK` de `historial_contratos`.
 */
export const MOTIVOS_CANCELACION = {
  mutuo_acuerdo: {
    etiqueta: 'Mutuo acuerdo',
    referencia: 'artículo 21 de la Ley 820 de 2003',
    canones_sugeridos: 0,
    a_cargo_de: null,
    solo_en_prorroga: false,
  },
  incumplimiento_inquilino: {
    etiqueta: 'Incumplimiento del arrendatario',
    referencia: 'artículo 22, numerales 1 a 6, de la Ley 820 de 2003',
    canones_sugeridos: 0,
    a_cargo_de: 'INQUILINO',
    solo_en_prorroga: false,
  },
  incumplimiento_propietario: {
    etiqueta: 'Incumplimiento del arrendador',
    referencia: 'artículo 24, numerales 1 a 3, de la Ley 820 de 2003',
    canones_sugeridos: 0,
    a_cargo_de: 'PROPIETARIO',
    solo_en_prorroga: false,
  },
  unilateral_inquilino: {
    etiqueta: 'Terminación unilateral del arrendatario',
    referencia: 'artículo 24, numeral 4, de la Ley 820 de 2003',
    canones_sugeridos: 3,
    a_cargo_de: 'INQUILINO',
    solo_en_prorroga: false,
  },
  unilateral_propietario: {
    etiqueta: 'Terminación unilateral del arrendador durante la prórroga',
    referencia: 'artículo 22, numeral 7, de la Ley 820 de 2003',
    canones_sugeridos: 3,
    a_cargo_de: 'PROPIETARIO',
    solo_en_prorroga: true,
  },
} as const satisfies Record<string, MotivoCancelacion>;

export type ClaveMotivoCancelacion = keyof typeof MOTIVOS_CANCELACION;

/** Cuerpo de `PUT /api/contratos/{id}/cancelar`. */
export interface CancelarContratoRequest {
  motivo: ClaveMotivoCancelacion;
  /** Pesos colombianos. Mayor o igual a 0. */
  indemnizacion: MontoCOP;
  /** Obligatorio si `indemnizacion` es mayor que 0. */
  indemnizacion_a_cargo_de?: ParteContrato;
}
