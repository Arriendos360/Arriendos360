/**
 * Plantillas de correo. Cada una recibe la carga del evento y el destinatario ya
 * resuelto, y devuelve `{ asunto, cuerpoHtml }`. Son funciones puras.
 */

import type {
  ContrasenaTemporalEmitida,
  CuentaCobroEnMora,
  CuentaCobroGenerada,
  CuentaCobroPorVencer,
  RecuperacionSolicitada,
} from 'arriendos360-shared';
import { ZONA_NEGOCIO, textoDeEntorno } from 'arriendos360-shared';

import type { Destinatario } from '../clientes/identidad';

/** Lo que una plantilla produce. Es lo que se guarda en la bitacora de envios. */
export interface Mensaje {
  asunto: string;
  cuerpoHtml: string;
}

/** Remitente de los correos. */
export const REMITENTE = textoDeEntorno(
  'EMAIL_REMITENTE',
  '"Arriendos360 🏠" <noreply@arriendos360.com>',
);

/** Base pública de la SPA, para los enlaces. Se lee en cada llamada. */
const urlApp = (): string =>
  textoDeEntorno('URL_APP', 'http://localhost:3000').replace(/\/+$/, '');

/** Pesos colombianos, con el mismo formato que los comprobantes. */
export const pesos = (valor: number | string): string =>
  `$ ${parseFloat(String(valor ?? 0)).toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;

/**
 * Una fecha `YYYY-MM-DD` en palabras. En UTC: con la zona local se imprimiría el
 * día anterior.
 */
export const fecha = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Un instante, con hora, en la zona del negocio. Para la caducidad del enlace. */
export const instante = (iso: string): string =>
  new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ZONA_NEGOCIO,
  });

/** Un periodo, como se nombra en una cuenta de cobro. */
const periodo = (inicio: string, fin: string): string => `${fecha(inicio)} al ${fecha(fin)}`;

/** El saludo. Sin nombre si no lo hay, en vez de un «Hola ,» suelto. */
const saludo = (destinatario: Destinatario): string =>
  destinatario.nombres ? `<p>Hola ${destinatario.nombres},</p>` : '<p>Hola,</p>';

/** Envoltura común de todos los correos. */
const envolver = (contenido: string): string => `
<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #222; line-height: 1.5;">
  ${contenido}
  <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0 12px;">
  <p style="font-size: 12px; color: #777;">
    Arriendos360 · Bogotá D.C. · Este es un mensaje automático, no responda a este correo.
  </p>
</div>`;

// ── ms-identidad ─────────────────────────────────────────────────────────────

/** Recuperación de contraseña: el enlace con el token y la hora exacta en que caduca. */
export const recuperacionSolicitada = (
  carga: RecuperacionSolicitada,
  destinatario: Destinatario,
): Mensaje => ({
  asunto: 'Restablece tu contraseña de Arriendos360',
  cuerpoHtml: envolver(`
    ${saludo(destinatario)}
    <p>Pediste restablecer tu contraseña. El enlace vale una sola vez y caduca el
       <strong>${instante(carga.expira_en)}</strong>:</p>
    <p><a href="${urlApp()}/restablecer?token=${encodeURIComponent(carga.token)}">Restablecer mi contraseña</a></p>
    <p>Si no fuiste tú, ignora este correo: tu contraseña no ha cambiado.</p>
  `),
});

/** Alta o reemisión de la contraseña temporal. No lleva la contraseña. */
export const contrasenaTemporalEmitida = (
  carga: ContrasenaTemporalEmitida,
  destinatario: Destinatario,
): Mensaje =>
  carga.motivo === 'ALTA'
    ? {
        asunto: '🏠 Se creó tu cuenta en Arriendos360',
        cuerpoHtml: envolver(`
          ${saludo(destinatario)}
          <p>Tu arrendador creó una cuenta a tu nombre en Arriendos360, donde podrás
             consultar tu contrato, tus cuentas de cobro y tus comprobantes de pago.</p>
          <p>Para entrar necesitas una contraseña temporal que <strong>te entregará
             quien te dio de alta</strong>: por seguridad no se envía por correo. La
             primera vez que entres tendrás que cambiarla por una tuya.</p>
          <p>Tu usuario es este mismo correo: <strong>${destinatario.email}</strong></p>
        `),
      }
    : {
        asunto: '🔑 Se regeneró tu contraseña temporal de Arriendos360',
        cuerpoHtml: envolver(`
          ${saludo(destinatario)}
          <p>Se generó una contraseña temporal nueva para tu cuenta. La anterior dejó
             de funcionar, y con ella se cerraron todas las sesiones abiertas.</p>
          <p>La contraseña nueva <strong>te la entregará tu arrendador</strong>: por
             seguridad no se envía por correo. Al entrar tendrás que cambiarla por
             una tuya.</p>
          <p>Si no esperabas esto, avisa a tu arrendador.</p>
        `),
      };

// ── ms-financiero ────────────────────────────────────────────────────────────

/** Recibo generado, al inquilino. */
export const cuentaCobroGenerada = (
  carga: CuentaCobroGenerada,
  destinatario: Destinatario,
): Mensaje => ({
  asunto: '🏠 Nuevo recibo de arriendo generado',
  cuerpoHtml: envolver(`
    ${saludo(destinatario)}
    <p>Se generó tu recibo de arriendo del periodo
       <strong>${periodo(carga.inicio, carga.fin)}</strong>.</p>
    <p>Valor: <strong>${pesos(carga.valor)}</strong></p>
    <p>Puedes consultarlo y descargarlo desde Arriendos360.</p>
  `),
});

/** Vencimiento próximo, al inquilino, con la fecha en que entra en mora. */
export const porVencerInquilino = (
  carga: CuentaCobroPorVencer,
  destinatario: Destinatario,
): Mensaje => ({
  asunto: '⚠️ Aviso: Tu pago vence pronto',
  cuerpoHtml: envolver(`
    ${saludo(destinatario)}
    <p>Tu pago de arriendo del inmueble <strong>${carga.direccion_inmueble}</strong>
       está próximo a vencer.</p>
    <p>Valor: <strong>${pesos(carga.valor)}</strong><br>
       Periodo: ${periodo(carga.inicio, carga.fin)}</p>
    <p>Si no se registra el pago, la cuenta pasará a mora el
       <strong>${fecha(carga.entra_en_mora_el)}</strong>.</p>
  `),
});

/** Vencimiento próximo, al propietario. */
export const porVencerPropietario = (
  carga: CuentaCobroPorVencer,
  destinatario: Destinatario,
): Mensaje => ({
  asunto: '📢 Recordatorio de pago próximo a vencer',
  cuerpoHtml: envolver(`
    ${saludo(destinatario)}
    <p>El pago del inmueble <strong>${carga.direccion_inmueble}</strong> está
       próximo a vencer.</p>
    <p>Valor: <strong>${pesos(carga.valor)}</strong><br>
       Periodo: ${periodo(carga.inicio, carga.fin)}</p>
    <p>La cuenta pasará a mora el <strong>${fecha(carga.entra_en_mora_el)}</strong>
       si no se registra el pago.</p>
  `),
});

/** Mora, al INQUILINO. */
export const enMoraInquilino = (
  carga: CuentaCobroEnMora,
  destinatario: Destinatario,
): Mensaje => ({
  asunto: '🚨 Pago Vencido - Mora Generada',
  cuerpoHtml: envolver(`
    ${saludo(destinatario)}
    <p>Tu pago de arriendo del inmueble <strong>${carga.direccion_inmueble}</strong>
       superó el periodo de gracia y la cuenta quedó en mora.</p>
    <p>Valor pendiente: <strong>${pesos(carga.valor)}</strong><br>
       Periodo: ${periodo(carga.inicio, carga.fin)}<br>
       Días desde la fecha de corte: ${carga.dias_de_mora}</p>
    <p>Por favor regulariza tu situación.</p>
  `),
});

/** Mora, al PROPIETARIO. */
export const enMoraPropietario = (
  carga: CuentaCobroEnMora,
  destinatario: Destinatario,
): Mensaje => ({
  asunto: '🔴 Notificación de Inquilino en Mora',
  cuerpoHtml: envolver(`
    ${saludo(destinatario)}
    <p>El inquilino del inmueble <strong>${carga.direccion_inmueble}</strong> entró
       en mora.</p>
    <p>Valor pendiente: <strong>${pesos(carga.valor)}</strong><br>
       Periodo: ${periodo(carga.inicio, carga.fin)}<br>
       Días desde la fecha de corte: ${carga.dias_de_mora}</p>
  `),
});
