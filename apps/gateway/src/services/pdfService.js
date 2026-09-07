'use strict';
const PDFDocument = require('pdfkit');

// ─── Paleta de colores ────────────────────────────────────────────────────────
const C = {
  primary    : '#1A3C5E',  // Azul marino  – encabezado
  secondary  : '#2E86C1',  // Azul medio   – secciones y pie
  accent     : '#27AE60',  // Verde        – "PAGADO" y total
  lightBg    : '#F4F8FB',  // Fondo alterno de filas
  border     : '#D5E8F5',  // Bordes suaves
  darkText   : '#1C2833',  // Texto principal
  mutedText  : '#7F8C8D',  // Etiquetas
  white      : '#FFFFFF',
  lightGreen : '#EAFAF1',  // Fondo caja total
};

// ─── Medidas base (puntos PDF, tamaño Letter 612 × 792) ──────────────────────
const PW     = 612;           // Page width
const PH     = 792;           // Page height
const MX     = 51;            // Margen horizontal (≈ 18 mm)
const CW     = PW - MX * 2;  // Ancho útil del contenido
const HDR    = 62;            // Alto de la franja de encabezado
const FTR    = 23;            // Alto de la franja de pie
const ROW_H  = 22;            // Alto de cada fila de datos
const SEC_H  = 20;            // Alto de la banda de sección
const PAD    = 8;             // Padding interno de celdas

// ─── Primitivas de dibujo ─────────────────────────────────────────────────────

function fillRect(doc, x, y, w, h, color) {
  doc.fillColor(color).rect(x, y, w, h).fill();
}

function strokeRect(doc, x, y, w, h, color, lw = 0.8) {
  doc.strokeColor(color).lineWidth(lw).rect(x, y, w, h).stroke();
}

function line(doc, x1, y1, x2, y2, color, lw = 0.4) {
  doc.strokeColor(color).lineWidth(lw).moveTo(x1, y1).lineTo(x2, y2).stroke();
}

function txt(doc, text, x, y, o = {}) {
  if (o.color !== undefined) doc.fillColor(o.color);
  if (o.font  !== undefined) doc.font(o.font);
  if (o.size  !== undefined) doc.fontSize(o.size);
  
  // Si hay lineBreak, desactivamos ellipsis por defecto para que el texto fluya
  const hasLineBreak = o.lineBreak !== undefined ? o.lineBreak : false;
  
  doc.text(String(text ?? ''), x, y, {
    lineBreak : hasLineBreak,
    width     : o.width,
    align     : o.align    || 'left',
    ellipsis  : o.ellipsis !== undefined ? o.ellipsis : (hasLineBreak ? false : true),
  });
}

// ─── Bloques estructurales ────────────────────────────────────────────────────

function encabezado(doc, data) {
  fillRect(doc, 0, 0, PW, HDR, C.primary);

  txt(doc, data.empresa_nombre, MX, 20,
    { color: C.white, font: 'Helvetica-Bold', size: 13, width: 320 });

  txt(doc, data.empresa_telefono, MX, 30,
    { color: C.white, font: 'Helvetica', size: 7.5, width: CW, align: 'right' });

  txt(doc, data.empresa_email, MX, 44,
    { color: C.white, font: 'Helvetica', size: 7.5, width: CW, align: 'right' });
}

function piePagina(doc, data) {
  const fy = PH - FTR;
  fillRect(doc, 0, fy, PW, FTR, C.secondary);
  txt(
    doc,
    `NIT: ${data.empresa_nit}  •  ${data.empresa_ciudad}  •  Documento generado electrónicamente`,
    0, fy + 7,
    { color: C.white, font: 'Helvetica', size: 7, width: PW, align: 'center' }
  );
}

function sectionBand(doc, titulo, y) {
  fillRect(doc, MX, y, CW, SEC_H, C.secondary);
  txt(doc, titulo, MX + PAD, y + 6,
    { color: C.white, font: 'Helvetica-Bold', size: 9, width: CW - PAD * 2 });
  return y + SEC_H;
}

/**
 * Tabla de 4 columnas: dos pares [etiqueta, valor] por fila.
 * Soporta multi-línea calculando la altura necesaria con buffer de seguridad.
 */
function tabla4Col(doc, rows, y) {
  const halfW = CW / 2;
  const lw    = halfW * 0.42; // Ancho etiqueta
  const vw    = halfW * 0.58; // Ancho valor
  
  let currentY = y;

  rows.forEach((row) => {
    // Medir alturas necesarias (ajustando fuente y tamaño antes de medir)
    doc.font('Helvetica-Bold').fontSize(9.5);
    const h1 = doc.heightOfString(row[1] || '', { width: vw - PAD * 2 });
    
    doc.font('Helvetica').fontSize(9.5);
    const h2 = row[3] ? doc.heightOfString(row[3], { width: vw - PAD * 2 }) : 0;
    
    // Reducimos el buffer vertical a 10 puntos (5 arriba, 5 abajo) para un look más ajustado
    const rowH = Math.max(ROW_H, h1 + 10, h2 + 10); 

    const bg = (currentY - y) / ROW_H % 2 === 0 ? C.white : C.lightBg;
    fillRect(doc, MX, currentY, CW, rowH, bg);

    // Separador vertical central
    line(doc, MX + halfW, currentY, MX + halfW, currentY + rowH, C.border);
    
    // Par izquierdo - Alineamos el texto un poco más arriba (+5 en lugar de +8)
    txt(doc, row[0], MX + PAD, currentY + 5,
      { color: C.mutedText, font: 'Helvetica-Bold', size: 8, width: lw - PAD });
    txt(doc, row[1], MX + lw + PAD, currentY + 5,
      { color: C.darkText, font: 'Helvetica-Bold', size: 9.5, width: vw - PAD * 2, lineBreak: true });

    // Par derecho
    if (row[2] && row[3]) {
      txt(doc, row[2], MX + halfW + PAD, currentY + 5,
        { color: C.mutedText, font: 'Helvetica-Bold', size: 8, width: lw - PAD });
      txt(doc, row[3], MX + halfW + lw + PAD, currentY + 5,
        { color: C.darkText, font: 'Helvetica', size: 9.5, width: vw - PAD * 2, lineBreak: true });
    }

    currentY += rowH;
    // Línea horizontal inferior de la fila
    line(doc, MX, currentY, MX + CW, currentY, C.border);
  });

  strokeRect(doc, MX, y, CW, currentY - y, C.border);
  return currentY;
}

function filaSimple(doc, label, value, y, bg, bold = false) {
  const labelW = CW * 0.34;
  const valueW = CW * 0.66;

  fillRect(doc, MX, y, CW, ROW_H, bg);
  line(doc, MX, y + ROW_H, MX + CW, y + ROW_H, C.border, 0.4);

  txt(doc, label, MX + PAD, y + 7,
    { color: C.mutedText, font: 'Helvetica-Bold', size: 8, width: labelW - PAD * 2 });
  txt(doc, value, MX + labelW + PAD, y + 7,
    { color: C.darkText, font: bold ? 'Helvetica-Bold' : 'Helvetica',
      size: 9.5, width: valueW - PAD * 2 });

  return y + ROW_H;
}

// ─── Función principal exportada ──────────────────────────────────────────────

function generarPDFComprobante(doc, data) {
  // Decoración de página
  encabezado(doc, data);
  piePagina(doc, data);

  let y = HDR + 12;

  // ── Título ────────────────────────────────────────────────────────────────
  txt(doc, 'COMPROBANTE DE PAGO', MX, y,
    { color: C.primary, font: 'Helvetica-Bold', size: 17, width: CW, align: 'center' });
  y += 22;

  txt(doc, 'Arrendamiento de inmueble', MX, y,
    { color: C.mutedText, font: 'Helvetica', size: 9, width: CW, align: 'center' });
  y += 16;

  // ── Banda de información rápida ───────────────────────────────────────────
  const BH = 34;
  fillRect  (doc, MX, y, CW, BH, C.lightBg);
  strokeRect(doc, MX, y, CW, BH, C.border);

  const z1 = CW * 0.35;  // Ancho columna N°
  const z2 = CW * 0.30;  // Ancho columna PAGADO

  txt(doc, 'N° COMPROBANTE', MX + 10, y + 7,
    { color: C.mutedText, font: 'Helvetica-Bold', size: 8 });
  txt(doc, data.numero_comprobante, MX + 10, y + 19,
    { color: C.darkText, font: 'Helvetica-Bold', size: 9.5, width: z1 - 20 });

  txt(doc, (data.estado_pago || 'PAGADO'), MX + z1, y + 12,
    { color: C.accent, font: 'Helvetica-Bold', size: 10, width: z2, align: 'center' });

  txt(doc, 'FECHA', MX + z1 + z2 + 10, y + 7,
    { color: C.mutedText, font: 'Helvetica-Bold', size: 8 });
  txt(doc, data.fecha_expedicion, MX + z1 + z2 + 10, y + 19,
    { color: C.darkText, font: 'Helvetica-Bold', size: 9.5, width: CW * 0.35 - 14 });

  y += BH + 14;

  // ── Sección 1: Arrendatario ───────────────────────────────────────────────
  y = sectionBand(doc, '1. DATOS DEL ARRENDATARIO', y);
  y = tabla4Col(doc, [
    ['Nombre completo', data.nombre_arrendatario,   'Cédula / NIT',       data.cedula_arrendatario],
    ['Teléfono',        data.telefono_arrendatario, 'Correo electrónico', data.email_arrendatario],
  ], y);
  y += 14;

  // ── Sección 2: Inmueble ───────────────────────────────────────────────────
  y = sectionBand(doc, '2. DATOS DEL INMUEBLE', y);
  y = tabla4Col(doc, [
    ['Dirección',        data.direccion_inmueble, 'Barrio / Ciudad', data.barrio_ciudad],
    ['Tipo de inmueble', data.tipo_inmueble,      'Período',         data.periodo],
  ], y);
  y += 14;

  // ── Sección 3: Detalle del pago ───────────────────────────────────────────
  y = sectionBand(doc, '3. DETALLE DEL PAGO', y);

  const filasPago = [
    { label: 'Concepto',           value: data.concepto,        bold: true  },
    { label: 'Canon mensual',      value: data.canon_mensual,   bold: false },
    { label: 'Saldo anterior',     value: data.saldo_anterior,  bold: false },
    { label: 'Valor pagado',       value: data.valor_pagado,    bold: true  },
    { label: 'Saldo pendiente',    value: data.saldo_pendiente, bold: false },
    { label: 'Forma de pago',      value: data.forma_pago,      bold: false },
    { label: 'Banco / Entidad',    value: data.banco,           bold: false },
    { label: 'Referencia trans.',  value: data.referencia_pago, bold: false },
  ];
  const yPagoStart = y;
  filasPago.forEach(({ label, value, bold }, i) => {
    y = filaSimple(doc, label, value, y, i % 2 === 0 ? C.white : C.lightBg, bold);
  });
  strokeRect(doc, MX, yPagoStart, CW, filasPago.length * ROW_H, C.border);
  y += 14;

  // ── Caja de total ─────────────────────────────────────────────────────────
  const TH = 40;
  fillRect  (doc, MX, y, CW, TH, C.lightGreen);
  strokeRect(doc, MX, y, CW, TH, C.accent, 1.5);

  txt(doc, 'TOTAL RECIBIDO:', MX + 14, y + 14,
    { color: C.primary, font: 'Helvetica-Bold', size: 12 });
  txt(doc, data.valor_pagado, MX, y + 13,
    { color: C.accent, font: 'Helvetica-Bold', size: 14,
      width: CW - 14, align: 'right' });

  y += TH + 28;

  const halfCW  = CW / 2;
  const lineLen = 160;

  line(doc,
    MX + (halfCW - lineLen) / 2, y,
    MX + (halfCW + lineLen) / 2, y,
    C.border, 1);
  txt(doc, 'Firma del Arrendador / Representante', MX, y + 7,
    { color: C.mutedText, font: 'Helvetica', size: 8,
      width: halfCW, align: 'center' });

  line(doc,
    MX + halfCW + (halfCW - lineLen) / 2, y,
    MX + halfCW + (halfCW + lineLen) / 2, y,
    C.border, 1);
  txt(doc, 'Firma del Arrendatario', MX + halfCW, y + 7,
    { color: C.mutedText, font: 'Helvetica', size: 8,
      width: halfCW, align: 'center' });

  y += 28;

  line(doc, MX, y, MX + CW, y, C.border, 0.5);
  y += 7;
  txt(doc,
    'Este comprobante es el único soporte válido del pago realizado. ' +
    'Consérvelo como constancia de su transacción. ' +
    'En caso de dudas comuníquese con nosotros al correo o teléfono indicados en el encabezado.',
    MX, y,
    { color: C.mutedText, font: 'Helvetica-Oblique', size: 7.5,
      width: CW, align: 'center', lineBreak: true }
  );
}

module.exports = { generarPDFComprobante };
