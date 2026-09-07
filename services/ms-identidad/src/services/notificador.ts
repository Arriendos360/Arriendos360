/**
 * Envio de notificaciones.
 *
 * DESVIACION TEMPORAL, y esta es la razon de que exista esta interfaz.
 *
 * El Capitulo 2 pone las notificaciones en `ms-notificaciones` (paso 7), al que
 * los demas servicios avisan publicando un evento en el bus: coreografia, no
 * orquestacion. Ms-identidad NO deberia saber que existe un servidor SMTP.
 *
 * Pero la recuperacion de contrasena necesita mandar un correo hoy, y ni el bus
 * ni ms-notificaciones existen todavia. Se manda directo, y se aisla detras de
 * esta interfaz para que el paso 7 sea sustituir la implementacion —de SMTP a
 * `publicar('RecuperacionSolicitada', ...)`— sin tocar una linea de la logica de
 * recuperacion. Ver docs/adr/0010.
 *
 * Por eso el metodo se llama `notificar` y no `enviarCorreo`: el nombre no debe
 * comprometerse con el canal.
 */

import nodemailer from 'nodemailer';

export interface Notificacion {
  /** A quien va dirigida. Cuando haya bus, sera el destinatario del evento. */
  para: string;
  asunto: string;
  cuerpoHtml: string;
}

export interface Notificador {
  notificar(notificacion: Notificacion): Promise<void>;
}

/**
 * Implementacion por SMTP.
 *
 * Con `EMAIL_USER` sin definir apunta a un buzon de pruebas (Ethereal) y no
 * llega a nadie de verdad. Es suficiente para desarrollo y es, ademas, la razon
 * por la que la contrasena temporal del ADR 0007 NO se envia por correo: hoy no
 * llegaria.
 */
export class NotificadorSmtp implements Notificador {
  private readonly transporte = nodemailer.createTransport({
    host: process.env['EMAIL_HOST'] ?? 'smtp.ethereal.email',
    port: Number(process.env['EMAIL_PORT'] ?? 587),
    auth: {
      user: process.env['EMAIL_USER'] ?? 'test@example.com',
      pass: process.env['EMAIL_PASS'] ?? 'password',
    },
  });

  public async notificar({ para, asunto, cuerpoHtml }: Notificacion): Promise<void> {
    if (process.env['NODE_ENV'] === 'test') {
      return;
    }

    try {
      await this.transporte.sendMail({
        from: '"Arriendos360 🏠" <noreply@arriendos360.com>',
        to: para,
        subject: asunto,
        html: cuerpoHtml,
      });
      console.log(`📧 Notificación enviada a ${para}: ${asunto}`);
    } catch (error) {
      // No se propaga: que el correo falle no puede cambiar la respuesta de
      // `/recuperar`, que tiene que ser siempre la misma exista o no la cuenta.
      console.error('❌ Error al notificar:', (error as Error).message);
    }
  }
}

/** Notificador que no hace nada. Es el que usan las pruebas. */
export class NotificadorNulo implements Notificador {
  public readonly enviadas: Notificacion[] = [];

  public async notificar(notificacion: Notificacion): Promise<void> {
    this.enviadas.push(notificacion);
  }
}

let activo: Notificador = new NotificadorSmtp();

/** El notificador en uso. */
export const notificador = (): Notificador => activo;

/** Sustituye el notificador. Lo usan las pruebas; el paso 7 lo usara de verdad. */
export const usarNotificador = (nuevo: Notificador): void => {
  activo = nuevo;
};
