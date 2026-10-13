/**
 * La carta del preaviso de no renovar en PDF, para imprimirla, firmarla y enviarla por el
 * servicio postal autorizado, como exige la Ley 820 de 2003. No se guarda.
 */

import PDFDocument from 'pdfkit';
import { ZONA_NEGOCIO } from 'arriendos360-shared';
import {
  CAUSALES_PREAVISO_ARRENDADOR,
  FUNDAMENTO_PREAVISO,
  MESES_PREAVISO_TERMINACION,
} from 'arriendos360-contracts';
import type { CausalPreaviso, PartePreaviso } from 'arriendos360-contracts';

import type { InmuebleAjeno } from '../clientes/inmuebles';
import type { Contrato } from '../models/Contrato';
import { fecha, nombre } from './documentoContrato';
import type { Persona } from './documentoContrato';

export interface DatosPreaviso {
  contrato: Pick<Contrato, 'id_contrato' | 'preaviso_enviado_en' | 'preaviso_vencimiento' | 'preaviso_causal'>;
  parte: PartePreaviso;
  inmueble: InmuebleAjeno;
  remitente: Persona;
  destinatario: Persona;
}

/** Arma el PDF y lo deja terminado, listo para `pipe`. */
export const documentoPreaviso = ({ contrato, parte, inmueble, remitente, destinatario }: DatosPreaviso): PDFKit.PDFDocument => {
  const doc = new PDFDocument({ size: 'LETTER', margin: 72 });
  const esArrendador = parte === 'PROPIETARIO';
  const vencimiento = fecha(contrato.preaviso_vencimiento as string);
  const ciudad = String(inmueble['ciudad'] ?? '') || 'la ciudad del inmueble';
  // El día del envío en Bogotá: en UTC, un envío de noche caería al día siguiente.
  const enviado = (contrato.preaviso_enviado_en as Date).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: ZONA_NEGOCIO,
  });

  doc.font('Helvetica').fontSize(10.5).text(`${ciudad}, ${enviado}`);
  doc.moveDown(1.5).text('Señor(a)').font('Helvetica-Bold').text(nombre(destinatario)).font('Helvetica');
  doc.text(`Documento ${destinatario.documento ?? ''}`);
  doc.text(esArrendador ? 'Arrendatario' : 'Arrendador');

  doc.moveDown(1.5).font('Helvetica-Bold').text('Referencia: preaviso de terminación del contrato de arrendamiento');
  doc.font('Helvetica').text(`Contrato de arrendamiento de vivienda urbana, folio ${contrato.id_contrato}`);
  doc.text(`Inmueble: ${String(inmueble['direccion'] ?? '')}, ${ciudad}`);

  const plazo = `con una antelación no menor de ${MESES_PREAVISO_TERMINACION} meses a esa fecha, conforme al ${FUNDAMENTO_PREAVISO[parte]}`;
  const cuerpo = esArrendador
    ? [
        `Yo, ${nombre(remitente)}, identificado con documento ${remitente.documento ?? ''}, en mi calidad de ARRENDADOR, le informo que daré por terminado el contrato de la referencia a su vencimiento, el ${vencimiento}, y que no se renovará. Le doy este preaviso ${plazo}.`,
        `Invoco la causal: ${CAUSALES_PREAVISO_ARRENDADOR[contrato.preaviso_causal as CausalPreaviso]}.`,
        `En consecuencia, le solicito restituir el inmueble el ${vencimiento}.`,
      ]
    : [
        `Yo, ${nombre(remitente)}, identificado con documento ${remitente.documento ?? ''}, en mi calidad de ARRENDATARIO, le informo que daré por terminado el contrato de la referencia a su vencimiento, el ${vencimiento}, y que no se renovará. Le doy este preaviso ${plazo}, que no exige invocar causal ni pagar indemnización.`,
        `En consecuencia, restituiré el inmueble el ${vencimiento}.`,
      ];

  doc.moveDown(1.5).text('Cordial saludo.');
  for (const parrafo of cuerpo) doc.moveDown().text(parrafo);

  doc.moveDown(4).text('______________________________');
  doc.text(nombre(remitente)).text(`Documento ${remitente.documento ?? ''}`).text(esArrendador ? 'EL ARRENDADOR' : 'EL ARRENDATARIO');

  doc
    .moveDown(3)
    .fontSize(8)
    .fillColor('#555555')
    .text(
      'Carta generada por Arriendos360 con el preaviso registrado. La ley exige enviarla por el servicio postal autorizado (correo certificado): el correo electrónico no lo reemplaza.',
      { align: 'center' },
    );

  doc.end();
  return doc;
};
