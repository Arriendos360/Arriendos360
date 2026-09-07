/**
 * Contratos de interfaz de MS-Inmuebles.
 *
 * Fuente: Documento Principal, Capitulo 2, seccion "Contratos de interfaz".
 *
 * Este archivo es la excepcion a la regla de que `packages/contracts` sea solo
 * tipos. `TIPOS_INMUEBLE` y `ESTADOS_INMUEBLE` emiten JavaScript de verdad
 * porque son un catalogo cerrado que tienen que compartir tres consumidores: el
 * servicio, que valida contra el; el frontend, que pinta el desplegable; y la
 * migracion, que declara el CHECK. Tener la lista en un solo sitio es lo unico
 * que evita que se separen en silencio — el caso tipico es agregar un tipo al
 * formulario y que la API lo rechace.
 */

/**
 * Tipos de inmueble admitidos.
 *
 * Catalogo CERRADO. Antes la columna era `tipo_inmueble VARCHAR(50)` libre, y
 * la base acumulo "Casa", "casa", "Apto" y "Apartamento" como valores
 * distintos: sin catalogo no se puede agrupar ni filtrar de forma fiable.
 *
 * En minusculas, a diferencia de los roles. Los roles viajan en los claims del
 * JWT y el Capitulo 2 los fija en mayusculas; esto es un atributo de negocio y
 * se guarda tal cual se compara. La presentacion la decide el frontend.
 */
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

/**
 * Estados de ocupacion de un inmueble.
 *
 * La columna se llama `estado` a secas, como en el modelo canonico. Se llamaba
 * `estado_ocupacion`.
 *
 * No lo escribe una persona: lo mueve el ciclo de vida del contrato. Un
 * inmueble pasa a `arrendado` cuando se formaliza un contrato sobre el y vuelve
 * a `disponible` cuando ese contrato se finaliza.
 */
export const ESTADOS_INMUEBLE = ['disponible', 'arrendado'] as const;

export type EstadoInmueble = (typeof ESTADOS_INMUEBLE)[number];

/** Es este valor uno de los estados del catalogo? */
export const esEstadoInmueble = (valor: unknown): valor is EstadoInmueble =>
  typeof valor === 'string' && (ESTADOS_INMUEBLE as readonly string[]).includes(valor);

/**
 * Cuerpo de `POST /api/inmuebles`.
 *
 * `id_propietario` NO aparece aqui a proposito: se inyecta desde los claims del
 * JWT. Es la regla dura 4 del proyecto — aceptarlo en el cuerpo permitiria
 * registrar inmuebles a nombre de otro usuario.
 *
 * En el modelo canonico `Inmuebles.id_propietario` es una referencia logica a
 * `Usuarios`, sin clave foranea fisica, porque cruza la frontera entre
 * MS-Inmuebles y MS-Identidad (regla dura 1).
 *
 * DIVERGENCIA CONOCIDA. El Capitulo 2 lista `alias`, `direccion`, `ciudad`,
 * `tipo`, `descripcion` y `estado`. La tabla real tiene ademas `departamento`,
 * `municipio`, `barrio`, `area_m2`, `habitaciones`, `banos`, `deposito`,
 * `parqueaderos` y `estrato`, que el producto usa y los PDF imprimen. El paso 4
 * solo alineo los dos campos que se le pidieron —`estado` y `tipo`—; convertir
 * `municipio` en `ciudad` y agregar `alias` y `descripcion` toca el formulario
 * del frontend y sale de su alcance.
 */
export interface CrearInmuebleRequest {
  direccion: string;
  tipo: TipoInmueble;
  departamento?: string;
  municipio?: string;
  barrio?: string;
  area_m2?: number;
  habitaciones?: number;
  banos?: number;
  deposito?: number;
  parqueaderos?: number;
  estrato?: number;
}

/**
 * Cuerpo de `POST /interno/inmuebles/:id/estado`.
 *
 * Lo llama otro servicio, no una persona: el estado de un inmueble lo mueve el
 * ciclo de vida del contrato. Ver `docs/adr/0011`.
 */
export interface CambiarEstadoInmuebleRequest {
  estado: EstadoInmueble;
  /** UUID de la persona cuya accion provoco el cambio, para la auditoria. */
  solicitado_por: string;
}
