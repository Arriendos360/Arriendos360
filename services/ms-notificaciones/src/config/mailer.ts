/**
 * El transporte de correo. La UNICA pieza del sistema que habla SMTP.
 *
 * ── ESTO SUSTITUYE A DOS MAILERS, Y AQUI YA NO ES PROVISIONAL ───────────────
 *
 * Venia de `services/ms-financiero/src/config/mailer.ts` —que a su vez venia de
 * `apps/gateway/src/config/mailer.js`— y de `services/notificador.ts` de
 * ms-identidad. Los dos declaraban en su cabecera que estaban en el sitio
 * equivocado y los dos apuntaban al paso 7. Los dos se han borrado.
 *
 * La diferencia con aquellos no es de codigo, es de sitio: un servicio Core que
 * abre una conexion SMTP esta mal, y este subdominio es Generico y existe para
 * eso. Que sea la misma llamada a `nodemailer` no lo hace la misma decision.
 *
 * ── Y HAY UN CAMBIO DE COMPORTAMIENTO QUE IMPORTA: AHORA PROPAGA ────────────
 *
 * Los dos mailers anteriores se tragaban el fallo con un `console.error`, y con
 * razon: quien llamaba era el motor o el controlador de `/recuperar`, y en los dos
 * casos avisar era lo accesorio. Un barrido que no manda un correo es un incidente
 * menor; uno que no genera las cuentas del mes porque el servidor de correo no
 * respondio, no.
 *
 * Aqui el correo NO es lo accesorio, es el trabajo. Asi que `enviarCorreo` LANZA, y
 * quien decide que hacer es `services/enviador.ts`: anota el error en la fila,
 * programa el reintento y, tras agotarlo, la aparta. Tragarse el fallo aqui haria
 * imposible lo que el paso 7 tenia que conseguir — que un envio fallido quede
 * registrado y se vea.
 *
 * ── EN DESARROLLO EL CORREO NO SALE DE LA MAQUINA, Y ESO ES DELIBERADO ──────
 *
 * SIN `EMAIL_USER` se usa el transporte JSON de nodemailer: `sendMail` acepta el
 * mensaje, lo devuelve serializado y no toca la red. El aviso queda como `enviado` en
 * `notificaciones.envios` y el mensaje entero sale por el log.
 *
 * ── Y ESTO CORRIGE UN FALLO QUE LLEVABA TIEMPO OCULTO ───────────────────────
 *
 * Los dos mailers que este archivo sustituye apuntaban a `smtp.ethereal.email` con
 * `test@example.com` / `password`, que NO son credenciales de Ethereal. Cada envio
 * fallaba con «Missing credentials for PLAIN» y los dos se tragaban el error con un
 * `console.error`, asi que en desarrollo NUNCA salio un correo — ni uno.
 *
 * CLAUDE.md lo daba por funcionando: «el enlace de recuperacion se genera y se envia,
 * pero para verlo hay que leerlo del log». La primera mitad no era cierta.
 *
 * Se descubrio en el paso 7 y no antes por una razon que conviene retener: el
 * mecanismo nuevo PROPAGA el fallo en vez de tragarselo, y la fila de la bitacora se
 * quedo en `pendiente` con su `ultimo_error` a la vista. El fallo no es nuevo; lo que
 * es nuevo es que se vea. Era exactamente el argumento de la decision 2 del
 * `docs/adr/0019`, cobrado el mismo dia.
 *
 * Con `EMAIL_HOST` y `EMAIL_USER` de verdad, el transporte es SMTP y el correo sale.
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { enteroDeEntorno, leerEntorno, textoDeEntorno } from 'arriendos360-shared';

import { REMITENTE } from '../plantillas';

dotenv.config();

// Con `??` directo sobre `process.env`, el `EMAIL_USER=` que pasa Compose —una cadena
// vacia, no `undefined`— acababa en el `auth` del transporte, y eso es lo que hizo
// invisible el fallo anterior. Aqui habia un `valorDe` local por esa razon; ahora lo
// resuelve `packages/shared/src/entorno.ts` para todos los servicios.
const usuarioSmtp = leerEntorno('EMAIL_USER');

/** `true` cuando no hay SMTP configurado: el mensaje no sale de la maquina. */
export const esSimulado = (): boolean => usuarioSmtp === undefined;

const transporte = usuarioSmtp
  ? nodemailer.createTransport({
      host: textoDeEntorno('EMAIL_HOST', 'smtp.ethereal.email'),
      port: enteroDeEntorno('EMAIL_PORT', 587),
      auth: { user: usuarioSmtp, pass: textoDeEntorno('EMAIL_PASS', '') },
    })
  : // Sin credenciales. `jsonTransport` acepta el mensaje y lo devuelve serializado sin
    // abrir una conexion, que es lo unico honesto que se puede hacer aqui: apuntar a un
    // servidor real con credenciales inventadas es lo que fallaba en silencio.
    nodemailer.createTransport({ jsonTransport: true });

/** Lo que el enviador necesita saber de un envio: si salio y con que referencia. */
export interface ResultadoEnvio {
  messageId: string;
  /** URL de vista previa, cuando el proveedor la da (Ethereal). */
  vistaPrevia?: string;
  /** `true` si el mensaje NO salio de la maquina. Ver `esSimulado`. */
  simulado?: boolean;
}

/**
 * Manda un correo. LANZA si no pudo.
 *
 * En `NODE_ENV=test` no se toca nada y se devuelve un resultado simulado, igual que
 * hacian los dos mailers anteriores. Las pruebas que necesitan comprobar el fallo no
 * dependen de eso: sustituyen esta funcion entera, que es lo que permite el parametro
 * `enviar` de `crearEnviador`.
 */
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
    // El mensaje entero, por el log. Es el unico sitio donde se puede leer el enlace de
    // recuperacion en desarrollo, y por eso se imprime completo en vez de resumido.
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
