/** Contratos de interfaz de MS-Inmuebles. */

/** Tipos de inmueble. Catálogo cerrado, espejo del `CHECK` de la migración. */
export const TIPOS_INMUEBLE = [
  'apartamento',
  'casa',
  'local',
  'oficina',
  'bodega',
  'apartaestudio',
] as const;

export type TipoInmueble = (typeof TIPOS_INMUEBLE)[number];

/** Es este valor uno de los tipos del catalogo? */
export const esTipoInmueble = (valor: unknown): valor is TipoInmueble =>
  typeof valor === 'string' && (TIPOS_INMUEBLE as readonly string[]).includes(valor);

/** Estados de ocupación de un inmueble. Los mueven los eventos de contrato. */
export const ESTADOS_INMUEBLE = ['disponible', 'arrendado'] as const;

export type EstadoInmueble = (typeof ESTADOS_INMUEBLE)[number];

/** Es este valor uno de los estados del catalogo? */
export const esEstadoInmueble = (valor: unknown): valor is EstadoInmueble =>
  typeof valor === 'string' && (ESTADOS_INMUEBLE as readonly string[]).includes(valor);

/** Longitud máxima del alias, igual que la columna. */
export const LONGITUD_MAXIMA_ALIAS = 100;

/** Cuerpo de `POST /api/inmuebles`. `id_propietario` sale del token, no del cuerpo. */
export interface CrearInmuebleRequest {
  /** Nombre corto con el que el propietario reconoce el inmueble. */
  alias: string;
  direccion: string;
  tipo: TipoInmueble;
  descripcion?: string;
  departamento?: string;
  ciudad?: string;
  barrio?: string;
  area_m2?: number;
  habitaciones?: number;
  banos?: number;
  deposito?: number;
  parqueaderos?: number;
  estrato?: number;
}
