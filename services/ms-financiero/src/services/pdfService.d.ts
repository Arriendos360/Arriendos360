/** Tipos de `pdfService.js`. */

/** Los textos que el comprobante imprime, ya formateados. */
export interface DatosComprobante {
  [clave: string]: string | number | undefined;
}

/** Dibuja el comprobante sobre un documento de PDFKit ya abierto; no lo cierra. */
export declare function generarPDFComprobante(doc: unknown, data: DatosComprobante): void;
