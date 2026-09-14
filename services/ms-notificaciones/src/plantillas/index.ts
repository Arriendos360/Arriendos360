/**
 * Las plantillas de correo del sistema, todas juntas y por primera vez.
 *
 * ── DE DONDE VIENEN ─────────────────────────────────────────────────────────
 *
 * De dos sitios donde no tenian que estar. Cuatro de las cinco estaban escritas
 * como cadenas dentro de un bucle de `services/motor.ts`, en ms-financiero; la
 * quinta, dentro del controlador de `POST /api/auth/recuperar`, en ms-identidad.
 * Es decir: dos servicios de dominio que sabian redactar HTML.
 *
 * Reunirlas aqui no es orden por el orden. Es lo que hace que el texto de un aviso
 * se pueda cambiar sin tocar el motor de facturacion, y que las cinco puedan
 * compartir la misma envoltura sin copiarla cinco veces.
 *
 * ── UNA PLANTILLA RECIBE DATOS, NO ENTIDADES ────────────────────────────────
 *
 * Cada funcion toma la carga del evento y el destinatario ya resuelto, y devuelve
 * `{ asunto, cuerpoHtml }`. No consulta nada, no sabe que existe una base de datos
 * y no decide a quien se manda: eso lo hace el manejador. Asi se pueden probar
 * como lo que son, funciones puras.
 *
 * ── EL ASUNTO Y EL TEXTO SE CONSERVAN DE LO QUE HABIA ───────────────────────
 *
 * Los emoji de los asuntos, incluidos. No es nostalgia: el paso 7 mueve de sitio
 * el envio, y si ademas cambiara lo que la gente recibe, no habria forma de saber
 * si un correo raro es culpa de la mudanza o del texto nuevo. Lo unico que cambia
 * es lo que TENIA que cambiar, y esta anotado donde ocurre.
 */

import type {
  ContrasenaTemporalEmitida,
  CuentaCobroEnMora,
  CuentaCobroGenerada,
  CuentaCobroPorVencer,
  RecuperacionSolicitada,
} from 'arriendos360-shared';
import { ZONA_NEGOCIO } from 'arriendos360-shared';

import type { Destinatario } from '../clientes/identidad';

/** Lo que una plantilla produce. Es lo que se guarda en la bitacora de envios. */
export interface Mensaje {
  asunto: string;
  cuerpoHtml: string;
}

/**
 * Una variable de entorno, o el valor por defecto si no hay nada util.
 *
 * `??` NO sirve, y es la trampa que dejo el remitente en `null` la primera vez que este
 * servicio mando un correo: Compose pasa `EMAIL_REMITENTE=` cuando la variable del host
 * esta vacia, y eso es una CADENA VACIA, no `undefined`. Con `??` la cadena vacia pasa.
 * Es la misma razon por la que CLAUDE.md avisa de no usar `??` con
 * `REVOCADOS_INTERVALO_MS`.
 */
const configurado = (nombre: string, porDefecto: string): string => {
  const valor = process.env[nombre]?.trim();
  return valor === undefined || valor === '' ? porDefecto : valor;
};

/** Remitente. Se conserva literal del mailer que este servicio sustituye. */
export const REMITENTE = configurado(
  'EMAIL_REMITENTE',
  '"Arriendos360 🏠" <noreply@arriendos360.com>',
);

/**
 * Base publica de la SPA. Vive AQUI porque armar un enlace es cosa del canal.
 *
 * Se lee en cada llamada y no una vez al cargar el modulo: asi las pruebas pueden
 * apuntarla a otro sitio, igual que hace la costura del gateway con `MS_*_URL`.
 */
const urlApp = (): string =>
  configurado('URL_APP', 'http://localhost:3000').replace(/\/+$/, '');

/**
 * Pesos colombianos. El mismo formateador que imprimen los comprobantes.
 *
 * Se copia y no se importa de ms-financiero a proposito: importarlo obligaria a
 * este servicio a depender de aquel, y la direccion de las dependencias es la
 * contraria — Core puede depender de Generico, no al reves. Son cuatro lineas.
 */
export const pesos = (valor: number | string): string =>
  `$ ${parseFloat(String(valor ?? 0)).toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;

/**
 * Una fecha de calendario, como la leeria una persona en Bogota.
 *
 * `timeZone` NO es un adorno, y es el mismo cuidado que tiene `fmtPeriodo` en los
 * comprobantes: las fechas de los eventos son `YYYY-MM-DD`, que `Date` interpreta
 * como medianoche UTC. Formatearlas en la zona del contenedor imprimiria el dia
 * anterior en Bogota — el recibo del 1 de junio aparecería como 31 de mayo.
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

/**
 * Envoltura comun de todos los correos.
 *
 * Es deliberadamente pobre: un `div` con una tipografia y un pie. El PMP declara
 * Tailwind y no esta instalado, y de todas formas el CSS de un correo no se parece
 * al de una pagina. Lo que importa aqui es que las cinco plantillas compartan
 * envoltura, no que sea bonita.
 */
const envolver = (contenido: string): string => `
<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #222; line-height: 1.5;">
  ${contenido}
  <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0 12px;">
  <p style="font-size: 12px; color: #777;">
    Arriendos360 · Bogotá D.C. · Este es un mensaje automático, no responda a este correo.
  </p>
</div>`;

// ── ms-identidad ─────────────────────────────────────────────────────────────

/**
 * Recuperacion de contrasena. Es la plantilla que estaba en `auth.controller.ts`.
 *
 * ── EL ENLACE SE ARMA AQUI, Y EL EVENTO SOLO TRAE EL TOKEN ─────────────────
 *
 * `URL_APP` es configuracion del canal, no del dominio: ms-identidad no tiene por
 * que saber en que dominio vive la SPA para poder emitir un token.
 *
 * ── LA CADUCIDAD SE DICE COMO INSTANTE, NO COMO «30 MINUTOS» ───────────────
 *
 * Y este es el unico cambio de texto respecto al correo anterior. Alli la frase
 * «caduca en 30 minutos» era cierta porque el envio ocurria dentro de la peticion
 * que creaba el token. Ahora hay una ventana entre las dos cosas, y los
 * reintentos la estiran: «30 minutos» seria una promesa que el enlace no cumple.
 *
 * El evento trae `expira_en` justamente para esto. Si el correo llega tarde, dice
 * una hora que ya paso —que es la verdad— en vez de prometer media hora que no
 * existe. Ver `docs/adr/0019`.
 */
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

/**
 * Alta o reemision de la contrasena temporal.
 *
 * ── ESTA PLANTILLA NO SUSTITUYE A NINGUNA, ES NUEVA ────────────────────────
 *
 * Y NO LLEVA LA CONTRASENA. El ADR 0007 decide que la temporal se entrega en mano
 * porque el sistema no puede garantizar que un correo llegue, y ese ADR sigue en
 * pie: este mensaje avisa de que la cuenta existe, no la abre.
 *
 * Existe porque un inquilino dado de alta por su arrendador no pidio nada y hoy no
 * recibe ningun aviso de que hay una cuenta a su nombre. Decirselo es lo minimo.
 */
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

/**
 * Recibo generado. Era el correo del final de `procesarContratos`.
 *
 * El texto de aquel decia «tu recibo para el periodo que inicia el ${diaCorte}»,
 * con el dia del mes suelto y sin mes ni año, porque era lo que el bucle tenia a
 * mano. Ahora el evento trae el periodo completo, asi que dice el periodo completo.
 *
 * Y lo recibe ademas quien emite un cobro a mano, que antes no mandaba nada. Ver
 * `docs/adr/0019`.
 */
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

/**
 * Vencimiento proximo, al INQUILINO. Era el primero de los dos avisos del motor.
 *
 * El texto anterior decia «tienes hasta mañana», que era cierto en el instante del
 * `sendMail` porque el envio iba dentro del barrido. Con el bus eso deja de ser
 * seguro: el evento trae la fecha en que la cuenta entra en mora, y aqui se dice
 * la fecha. Una frase relativa se vuelve falsa sola; una fecha no.
 */
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

/** Vencimiento proximo, al PROPIETARIO. El segundo de los dos. */
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
