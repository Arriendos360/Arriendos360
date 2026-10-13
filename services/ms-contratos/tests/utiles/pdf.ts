/**
 * El texto de un PDF de PDFKit, para afirmar sobre lo impreso. Copia de la de
 * `services/ms-financiero/tests/comprobantes.test.ts`, donde se explica el porqué.
 *
 * Infla los flujos Flate con `zlib` y decodifica los operadores `TJ`/`Tj`, que
 * PDFKit escribe en hexadecimal. Sólo sirve con fuentes estándar (Helvetica):
 * con una incrustada los códigos son índices de glifo y esto deja de leerse.
 */

import zlib from 'zlib';

export const textoDelPdf = (cuerpo: Buffer): string => {
  const flujos: string[] = [];
  let desde = 0;

  for (;;) {
    const inicio = cuerpo.indexOf('stream', desde);
    if (inicio === -1) break;

    const fin = cuerpo.indexOf('endstream', inicio);
    if (fin === -1) break;

    // Saltar el salto de linea que sigue a `stream`, sea \n o \r\n.
    let datos = inicio + 'stream'.length;
    if (cuerpo[datos] === 0x0d) datos += 1;
    if (cuerpo[datos] === 0x0a) datos += 1;

    try {
      flujos.push(zlib.inflateSync(cuerpo.subarray(datos, fin)).toString('latin1'));
    } catch {
      /* no es un flujo Flate: no interesa */
    }

    desde = fin + 'endstream'.length;
  }

  const contenido = flujos.join('\n');
  const bloques = contenido.match(/\[[^\]]*\]\s*TJ|\((?:\\.|[^\\()])*\)\s*Tj/g) ?? [];

  return bloques
    .map((bloque) => {
      const piezas = bloque.match(/<[0-9A-Fa-f]*>|\((?:\\.|[^\\()])*\)/g) ?? [];

      return piezas
        .map((pieza) =>
          pieza.startsWith('<')
            ? Buffer.from(pieza.slice(1, -1), 'hex').toString('latin1')
            : pieza.slice(1, -1).replace(/\\([()\\])/g, '$1'),
        )
        .join('');
    })
    .join(' ');
};
