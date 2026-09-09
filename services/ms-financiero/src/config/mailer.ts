/**
 * Envio de correo del motor financiero.
 *
 * Se muda desde `apps/gateway/src/config/mailer.js` sin cambiar de
 * comportamiento: mismo transporte, mismo remitente, misma simulacion bajo
 * `NODE_ENV=test`. Lo unico que cambia es que ahora es TypeScript, porque el
 * archivo se estaba tocando de todas formas al moverlo.
 *
 * ── ESTO ES PROVISIONAL, Y CONVIENE QUE SE VEA ──────────────────────────────
 *
 * Un servicio Core que abre una conexion SMTP no esta bien, y el Capitulo 2 ya
 * dice cual es el sitio: `ms-notificaciones`, subdominio Generico. Es la misma
 * deuda que el `docs/adr/0010` dejo anotada para el correo de recuperacion de
 * ms-identidad, con la misma fecha de vencimiento — el paso 7.
 *
 * Lo que cambiara entonces NO es «mover este archivo». El motor dejara de
 * mandar correos y pasara a PUBLICAR eventos —una cuenta esta proxima a vencer,
 * una cuenta entro en mora— y sera Notificaciones quien decida a quien avisar y
 * por que canal. Eso convierte a este servicio en productor del bus, con su
 * tabla de salida en su esquema, y le quita de encima saber que existen los
 * correos electronicos. Hasta entonces, esto.
 *
 * ── EL CORREO NO LLEGA A NADIE EN DESARROLLO ────────────────────────────────
 *
 * Con `EMAIL_USER` sin definir el transporte apunta a un buzon de pruebas
 * (Ethereal). El aviso se genera y se envia, pero para verlo hay que leer la URL
 * de vista previa del log.
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env['EMAIL_HOST'] ?? 'smtp.ethereal.email',
  port: Number(process.env['EMAIL_PORT'] ?? 587),
  auth: {
    user: process.env['EMAIL_USER'] ?? 'test@example.com',
    pass: process.env['EMAIL_PASS'] ?? 'password',
  },
});

/**
 * Manda un correo, o lo simula en pruebas.
 *
 * NO PROPAGA. Un fallo de SMTP se registra y se traga a proposito: quien llama
 * es el motor, y avisar es lo accesorio. Un barrido que no manda un correo es un
 * incidente menor; uno que no genera las cuentas de cobro del mes porque el
 * servidor de correo no respondio, no.
 */
export const enviarCorreo = async (
  destinatario: string | undefined,
  asunto: string,
  html: string,
): Promise<{ messageId: string } | undefined> => {
  if (!destinatario) {
    return undefined;
  }

  if (process.env['NODE_ENV'] === 'test') {
    console.log(`🧪 [TEST MODE] Simulación de correo a ${destinatario}: ${asunto}`);
    return { messageId: 'test-id' };
  }

  try {
    const info = await transporter.sendMail({
      from: '"Arriendos360 🏠" <noreply@arriendos360.com>',
      to: destinatario,
      subject: asunto,
      html,
    });
    console.log(`📧 Correo enviado a ${destinatario}: ${asunto}`);

    if (process.env['NODE_ENV'] !== 'production') {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }

    return info as unknown as { messageId: string };
  } catch (error) {
    console.error('❌ Error enviando correo:', error);
    return undefined;
  }
};
