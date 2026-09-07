/**
 * Contratos de interfaz de MS-Contratos.
 *
 * Fuente: Documento Principal, Capitulo 2, seccion "Contratos de interfaz".
 */

import type { DiaDelMes, FechaISO, MontoCOP, UUID } from './comunes';

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
  fecha_inicio_corte: FechaISO;
  /**
   * Dia del mes (entero, 1-31) en que vence el pago. NO es una fecha, aunque
   * los tres campos anteriores si lo sean. El documento lo ejemplifica con `5`.
   */
  fecha_limite_pago: DiaDelMes;
  canon: MontoCOP;
  nombre_deudor_solidario: string;
  documento_deudor_solidario: string;
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
