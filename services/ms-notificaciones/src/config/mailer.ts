/**
 * Transporte de correo: la única pieza del sistema que habla SMTP. `enviarCorreo`
 * lanza si no pudo enviar. Sin `EMAIL_USER`, el correo no sale de la máquina y se
 * imprime entero en el log.
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { enteroDeEntorno, leerEntorno, textoDeEntorno } from 'arriendos360-shared';

import { REMITENTE } from '../plantillas';

dotenv.config();

const usuarioSmtp = leerEntorno('EMAIL_USER');

/** `true` cuando no hay SMTP configurado: el mensaje no sale de la maquina. */
export const esSimulado = (): boolean => usuarioSmtp === undefined;

const transporte = usuarioSmtp
  ? nodemailer.createTransport({
      host: textoDeEntorno('EMAIL_HOST', 'smtp.ethereal.email'),
      port: enteroDeEntorno('EMAIL_PORT', 587),
      auth: { user: usuarioSmtp, pass: textoDeEntorno('EMAIL_PASS', '') },
    })
  : // Sin credenciales: acepta el mensaje y lo devuelve serializado, sin red.
    nodemailer.createTransport({ jsonTransport: true });

/** Lo que el enviador necesita saber de un envio: si salio y con que referencia. */
export interface ResultadoEnvio {
  messageId: string;
  /** URL de vista previa, cuando el proveedor la da (Ethereal). */
  vistaPrevia?: string;
  /** `true` si el mensaje NO salio de la maquina. Ver `esSimulado`. */
  simulado?: boolean;
}

/** Manda un correo. Lanza si no pudo. Con `NODE_ENV=test` sólo lo simula. */
export const enviarCorreo = async (
  destinatario: string,
  asunto: string,
  html: string,
): Promise<ResultadoEnvio> => {
  if (process.env['NODE_ENV'] === 'test') {
    console.log(`🧪 [TEST MODE] Simulación de correo a ${destinatario}: ${asunto}`);
    return { messageId: 'test-id', simulado: true };
  }

  const info = await transporte.sendMail({
    from: REMITENTE,
    to: destinatario,
    subject: asunto,
    html,
  });

  const resultado: ResultadoEnvio = { messageId: info.messageId };

  if (esSimulado()) {
    // El mensaje completo, que en desarrollo es donde se lee el enlace de recuperación.
    resultado.simulado = true;
    console.log(
      `📭 ms-notificaciones: correo SIMULADO (sin EMAIL_USER, no salió de la máquina) ` +
        `a ${destinatario}: ${asunto}\n${String((info as { message?: unknown }).message ?? '')}`,
    );
  } else {
    const vistaPrevia = nodemailer.getTestMessageUrl(info);
    if (vistaPrevia) {
      resultado.vistaPrevia = vistaPrevia;
    }
  }

  return resultado;
};
