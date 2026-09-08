/**
 * Contratos de interfaz de MS-Contratos.
 *
 * Fuente: Documento Principal, Capitulo 2, seccion "Contratos de interfaz".
 */

import type { DiaDelMes, FechaISO, MontoCOP, UUID } from './comunes';

/**
 * Estados de un contrato.
 *
 * Catalogo CERRADO, igual que `ESTADOS_INMUEBLE`. Emite JavaScript porque lo
 * comparten tres consumidores: el modelo, que valida contra el; el frontend, que
 * pinta la etiqueta; y el `CHECK` de la migracion.
 *
 * SUSTITUYE A UN ENTERO. La columna guardaba `1`, `2` y `3` sin nada que dijera
 * que significaban: la traduccion vivia repartida entre el motor financiero, el
 * dashboard, el guardia de borrado y un ternario del frontend, cada uno con su
 * copia del mapa. Un `WHERE estado = 1` no se puede leer ni revisar; un
 * `WHERE estado = 'activo'` si.
 *
 * Los valores salen de la vieja tabla `estados_contrato` del modelo legado
 * —Activo, Finalizado, Cancelado— normalizados a minusculas, que es la
 * convencion del proyecto para catalogos de negocio y lo mismo que se hizo con
 * `TIPOS_INMUEBLE` cuando salio de `tipos_inmueble`. Las mayusculas se reservan
 * para los roles, que viajan en los claims y el Capitulo 2 fija asi.
 *
 * `cancelado` no lo produce ningun camino de codigo todavia —el frontend ya lo
 * pintaba, prevision de un flujo que no existe— pero se declara: un catalogo que
 * se queda corto obliga a otra migracion, y esta lista ya estaba escrita.
 */
export const ESTADOS_CONTRATO = ['activo', 'finalizado', 'cancelado'] as const;

export type EstadoContrato = (typeof ESTADOS_CONTRATO)[number];

/** Es este valor uno de los estados del catalogo? */
export const esEstadoContrato = (valor: unknown): valor is EstadoContrato =>
  typeof valor === 'string' && (ESTADOS_CONTRATO as readonly string[]).includes(valor);

/**
 * Cuerpo de `POST /api/contratos`.
 *
 * `id_inmueble` e `id_inquilino` son referencias logicas: apuntan a datos que
 * viven en MS-Inmuebles y MS-Identidad, sin clave foranea fisica (regla dura 1).
 * MS-Contratos asume que el ID existe; la validacion ocurre en el gateway o en
 * una llamada sincrona previa.
 */
export interface CrearContratoRequest {
  id_inmueble: UUID;
  id_inquilino: UUID;
  inicio: FechaISO;
  fin: FechaISO;
  /**
   * Primera fecha de corte del ciclo de facturacion. Opcional en la peticion:
   * si no viene, se deriva de `inicio`. Ver `fechasContrato` en el gateway.
   */
  fecha_inicio_corte?: FechaISO;
  /**
   * Dia del mes (entero, 1-31) en que vence el pago. NO es una fecha, aunque
   * los campos anteriores si lo sean. El documento lo ejemplifica con `5`.
   *
   * Opcional: si no viene, se deriva del dia de `inicio`. Que se pueda mandar es
   * lo que permite que el formulario lo ofrezca como sugerencia editable.
   */
  fecha_limite_pago?: DiaDelMes;
  canon: MontoCOP;
  /**
   * Deudor solidario. OPCIONALES los dos: no todo arriendo tiene codeudor, y
   * exigirlos impediria registrar los que no lo tienen.
   *
   * No es desviacion del Capitulo 2. El documento los lista como atributos de
   * `Contratos` y los muestra en el payload de ejemplo, pero no dice que sean
   * obligatorios; la seccion de Persistencia no fija nulabilidad de ningun
   * campo. Y CLAUDE.md ya establece como se leen esos ejemplos: lo vinculante
   * son los campos y sus nombres, no los valores de muestra.
   */
  nombre_deudor_solidario?: string;
  documento_deudor_solidario?: string;
  /** Texto libre con las condiciones particulares. Opcional. */
  info_contrato?: string;
}

/**
 * Tipo de anexo de un contrato.
 *
 * El documento enumera `CONTRATO_FIRMADO` y `OTROSI` seguidos de "etc.", asi que
 * la lista queda abierta. La interseccion `string & {}` conserva el autocompletado
 * de los valores conocidos sin cerrar el tipo a solo esos dos.
 */
export type TipoAnexo = 'CONTRATO_FIRMADO' | 'OTROSI' | (string & {});

/**
 * Campos del `multipart/form-data` de
 * `POST /api/contratos/{id_contrato}/anexos`.
 *
 * No es un cuerpo JSON: viaja como multipart porque lleva un archivo. El
 * servicio valida que sea PDF y que el contrato exista, sube el archivo a
 * almacenamiento en la nube y guarda la URL devuelta en `archivo_anexo`.
 *
 * `file` queda como `unknown` a proposito: su representacion concreta depende
 * del runtime (`Buffer` o stream en Node, `File` en el navegador) y este paquete
 * es solo de tipos, sin dependencias de entorno.
 */
export interface CrearAnexoFormData {
  file: unknown;
  tipo: TipoAnexo;
}
