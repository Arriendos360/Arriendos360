/**
 * El contrato de arrendamiento de vivienda urbana (Ley 820 de 2003) en PDF,
 * armado con los datos registrados. No se guarda: la versión que vale es la
 * firmada, que se sube como anexo.
 */

import PDFDocument from 'pdfkit';
import { hoyEnZonaNegocio } from 'arriendos360-shared';

import type { InmuebleAjeno } from '../clientes/inmuebles';
import type { Contrato } from '../models/Contrato';

/** Lo que el documento lee de una persona. */
export interface Persona {
  nombres?: string;
  apellidos?: string;
  documento?: string;
}

export interface DatosContrato {
  contrato: Pick<
    Contrato,
    | 'id_contrato'
    | 'inicio'
    | 'fin'
    | 'canon'
    | 'fecha_inicio_corte'
    | 'fecha_limite_pago'
    | 'info_contrato'
    | 'nombre_deudor_solidario'
    | 'documento_deudor_solidario'
  >;
  inmueble: InmuebleAjeno;
  arrendador: Persona;
  arrendatario: Persona;
}

const ORDINALES = [
  'PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'SEXTA',
  'SÉPTIMA', 'OCTAVA', 'NOVENA', 'DÉCIMA', 'UNDÉCIMA', 'DUODÉCIMA',
];

/** En UTC: con la zona local, una fecha a medianoche caería el día anterior. */
const fecha = (valor: Date | string): string =>
  new Date(valor).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const dinero = (valor: number | string): string =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(valor));

const nombre = (persona: Persona): string =>
  `${persona.nombres ?? ''} ${persona.apellidos ?? ''}`.trim();

const vacio = (valor: unknown): boolean => valor === null || valor === undefined || valor === '';

/** Arma el PDF y lo deja terminado, listo para `pipe`. */
export const documentoContrato = ({
  contrato,
  inmueble,
  arrendador,
  arrendatario,
}: DatosContrato): PDFKit.PDFDocument => {
  const doc = new PDFDocument({ size: 'LETTER', margin: 72 });
  const deudor = contrato.nombre_deudor_solidario?.trim();
  const condiciones = contrato.info_contrato?.trim();
  const ciudad = [inmueble['ciudad'], inmueble['departamento']].filter((v) => !vacio(v)).join(', ');

  const ficha = (
    [
      ['Barrio', inmueble['barrio']],
      ['Área', vacio(inmueble['area_m2']) ? null : `${Number(inmueble['area_m2']).toLocaleString('es-CO')} m²`],
      ['Habitaciones', inmueble['habitaciones']],
      ['Baños', inmueble['banos']],
      ['Parqueaderos', inmueble['parqueaderos']],
      ['Estrato', inmueble['estrato']],
    ] as Array<[string, unknown]>
  ).filter(([, valor]) => !vacio(valor));

  // Las opcionales van en `null` y se filtran antes de numerar.
  const clausulas = [
    {
      titulo: 'OBJETO',
      texto:
        'EL ARRENDADOR concede a EL ARRENDATARIO el uso y goce del inmueble descrito en este documento, y EL ARRENDATARIO paga por ese uso y goce el canon aquí pactado.',
    },
    {
      titulo: 'DESTINACIÓN',
      texto:
        'EL ARRENDATARIO destinará el inmueble exclusivamente a vivienda suya y de su familia, y no podrá darle otro uso.',
    },
    {
      titulo: 'CANON Y FORMA DE PAGO',
      texto: `El canon mensual es de ${dinero(contrato.canon)}, que EL ARRENDATARIO pagará a más tardar el día ${contrato.fecha_limite_pago} de cada mes. La primera fecha de corte es el ${fecha(contrato.fecha_inicio_corte)}.`,
    },
    {
      titulo: 'TÉRMINO',
      texto: `El contrato rige desde el ${fecha(contrato.inicio)} hasta el ${fecha(contrato.fin)}.`,
    },
    {
      titulo: 'INCREMENTO',
      texto:
        'Cada doce (12) meses de ejecución del contrato bajo un mismo precio, EL ARRENDADOR podrá incrementar el canon en una proporción que no supere el cien por ciento (100%) del incremento del índice de precios al consumidor (IPC) del año calendario inmediatamente anterior, conforme al artículo 20 de la Ley 820 de 2003.',
    },
    {
      titulo: 'SERVICIOS PÚBLICOS',
      texto:
        'El pago de los servicios públicos domiciliarios del inmueble durante la vigencia del contrato está a cargo de EL ARRENDATARIO.',
    },
    {
      titulo: 'CONSERVACIÓN Y REPARACIONES',
      texto:
        'EL ARRENDATARIO cuidará el inmueble y hará a su cargo las reparaciones locativas. EL ARRENDADOR hará las reparaciones necesarias para conservarlo en estado de servir a su destinación.',
    },
    {
      titulo: 'CESIÓN Y SUBARRIENDO',
      texto:
        'EL ARRENDATARIO no podrá ceder el contrato ni subarrendar el inmueble, total o parcialmente, sin autorización escrita de EL ARRENDADOR.',
    },
    {
      titulo: 'TERMINACIÓN Y PREAVISO',
      texto:
        'Las partes pueden terminar el contrato de mutuo acuerdo. Cualquiera de ellas puede darlo por terminado al vencimiento del término mediante preaviso escrito a la otra con una antelación no menor de tres (3) meses, en los términos de la Ley 820 de 2003.',
    },
    deudor
      ? {
          titulo: 'DEUDOR SOLIDARIO',
          texto: `${deudor}, identificado con documento ${contrato.documento_deudor_solidario ?? ''}, se obliga solidariamente con EL ARRENDATARIO al cumplimiento de todas las obligaciones de este contrato, durante su término y sus prórrogas.`,
        }
      : null,
    condiciones ? { titulo: 'CONDICIONES PARTICULARES', texto: condiciones } : null,
    {
      titulo: 'MÉRITO EJECUTIVO',
      texto:
        'Este contrato presta mérito ejecutivo para exigir el pago de los cánones, de los servicios públicos y de las demás obligaciones a cargo de las partes.',
    },
  ].filter((clausula) => clausula !== null);

  doc.font('Helvetica-Bold').fontSize(14).text('CONTRATO DE ARRENDAMIENTO DE VIVIENDA URBANA', {
    align: 'center',
  });
  doc.font('Helvetica').fontSize(9).text(`Folio ${contrato.id_contrato}`, { align: 'center' });
  doc.moveDown(1.5).fontSize(10.5);

  doc.text(
    `Entre ${nombre(arrendador)}, identificado con documento ${arrendador.documento ?? ''}, quien en adelante se denomina EL ARRENDADOR, y ${nombre(arrendatario)}, identificado con documento ${arrendatario.documento ?? ''}, quien en adelante se denomina EL ARRENDATARIO, se celebra el presente contrato de arrendamiento de vivienda urbana, regido por la Ley 820 de 2003 y por las cláusulas siguientes.`,
  );

  doc.moveDown().font('Helvetica-Bold').text('EL INMUEBLE').font('Helvetica');
  doc.text(`Dirección: ${String(inmueble['direccion'] ?? '')}`);
  if (ciudad) doc.text(`Ciudad: ${ciudad}`);
  doc.text(`Tipo: ${String(inmueble['tipo'] ?? '')}`);
  for (const [etiqueta, valor] of ficha) doc.text(`${etiqueta}: ${String(valor)}`);

  clausulas.forEach(({ titulo, texto }, i) => {
    doc.moveDown().font('Helvetica-Bold').text(`${ORDINALES[i] ?? i + 1}. ${titulo}.`);
    doc.font('Helvetica').text(texto);
  });

  doc.moveDown().text(
    `Para constancia se firma en ${String(inmueble['ciudad'] ?? '') || 'la ciudad del inmueble'}, el ${fecha(hoyEnZonaNegocio())}.`,
  );

  const firmas: Array<[string, Persona]> = [
    ['EL ARRENDADOR', arrendador],
    ['EL ARRENDATARIO', arrendatario],
  ];
  if (deudor) {
    firmas.push(['DEUDOR SOLIDARIO', { nombres: deudor, documento: contrato.documento_deudor_solidario ?? '' }]);
  }
  for (const [rol, persona] of firmas) {
    doc.moveDown(3).text('______________________________');
    doc.text(nombre(persona)).text(`Documento ${persona.documento ?? ''}`).text(rol);
  }

  doc
    .moveDown(2)
    .fontSize(8)
    .fillColor('#555555')
    .text(
      'Documento generado por Arriendos360 con los datos registrados del contrato. Se firma por fuera del sistema y la copia firmada se adjunta al contrato como anexo.',
      { align: 'center' },
    );

  doc.end();
  return doc;
};
