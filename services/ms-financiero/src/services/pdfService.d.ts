/**
 * Tipos de `pdfService.js`, que es el UNICO `.js` de este servicio.
 *
 * ── POR QUE SIGUE SIENDO JAVASCRIPT ─────────────────────────────────────────
 *
 * CLAUDE.md dice que todo codigo nuevo va en `.ts` y que un `.js` se convierte
 * «solo cuando ya lo estas modificando por otra razon». Este no se estaba
 * modificando: se estaba MOVIENDO, y ese es justamente el motivo para no
 * tocarlo.
 *
 * El requisito del paso 6e es que los comprobantes impriman exactamente lo mismo
 * que antes de la extraccion. Son 281 lineas de coordenadas, colores y anchos de
 * celda; reescribirlas en TypeScript no habria añadido un solo tipo util —el
 * modulo exporta una funcion que recibe un documento de PDFKit y un objeto de
 * textos ya formateados— y habria convertido una comprobacion trivial (un `git
 * mv` sin diff) en una revision visual pagina a pagina.
 *
 * Asi que se mueve intacto y se le pone tipo desde fuera, que es lo que este
 * archivo hace: TypeScript resuelve `./pdfService` a este `.d.ts` para tipar, y
 * `allowJs` —activado en el `tsconfig.json` del servicio SOLO para esto, con
 * `checkJs` apagado— hace que el `.js` se emita a `dist/`.
 *
 * El dia que haya que cambiar como se dibuja un comprobante, ese dia se
 * convierte. Ver `docs/adr/0018`.
 */

/**
 * Los textos que el comprobante imprime, ya formateados.
 *
 * Es deliberadamente abierto: quien construye este objeto son los dos
 * generadores de `controllers/pago.controller.ts`, y las claves que consume el
 * dibujo estan documentadas alli, junto a los valores. Cerrarlo aqui obligaria a
 * mantener la lista en dos sitios.
 */
export interface DatosComprobante {
  [clave: string]: string | number | undefined;
}

/**
 * Dibuja el comprobante sobre un documento de PDFKit ya abierto.
 *
 * No cierra el documento ni decide a donde va: de eso responde quien lo llama.
 * `doc` es `unknown` porque el modulo no declara el tipo de PDFKit y tiparlo
 * aqui seria inventarse una dependencia que el `.js` no tiene.
 */
export declare function generarPDFComprobante(doc: unknown, data: DatosComprobante): void;
