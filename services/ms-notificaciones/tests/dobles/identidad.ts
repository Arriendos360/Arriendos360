/**
 * Doble de MS-Identidad para las pruebas de MS-Notificaciones.
 *
 * Doble HTTP y no un mock de funcion, siguiendo la convencion del paso 3: el cliente
 * pide por red, asi que para probarlo hace falta algo que escuche. Y ademas permite
 * simular lo incomodo — que el otro extremo no responda, que devuelva un usuario sin
 * correo, que el correo de alguien haya cambiado entre dos eventos.
 *
 * EXIGE LA CREDENCIAL DE SERVICIO, igual que el real. Si no lo hiciera, las suites
 * pasarian aunque el cliente olvidara mandarla, que es exactamente el fallo que este
 * doble tiene que poder atrapar.
 *
 * ── ES EL UNICO DOBLE QUE ESTE SERVICIO NECESITA ────────────────────────────
 *
 * Y eso dice algo del diseño: ms-notificaciones habla con un solo servicio, y solo
 * para una cosa —resolver el correo de un `id_usuario`—. No pregunta por contratos ni
 * por inmuebles ni por cuentas de cobro: todo lo que necesita de esos dominios viaja
 * en el sobre. Los emisores tampoco aparecen aqui: nadie llama a este servicio por
 * HTTP salvo el transporte del bus, y eso se ejercita haciendo el POST de verdad.
 */

import express from 'express';
import type { Server } from 'http';
import { exigirServicio } from 'arriendos360-shared';

export interface UsuarioFalso {
  id: string;
  nombres?: string;
  apellidos?: string;
  email?: string;
}

export interface DobleIdentidad {
  url: string;
  usuarios: Map<string, UsuarioFalso>;
  llamadas: Array<{ metodo: string; ruta: string }>;
  caer: (codigo?: number) => void;
  levantar: () => void;
  limpiarLlamadas: () => void;
  cerrar: () => Promise<void>;
}

const escuchar = async (app: express.Express): Promise<{ servidor: Server; url: string }> => {
  const servidor = await new Promise<Server>((resolver) => {
    const s = app.listen(0, '127.0.0.1', () => resolver(s));
  });

  const direccion = servidor.address();
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;

  return { servidor, url: `http://127.0.0.1:${puerto}` };
};

const cerrarServidor = (servidor: Server): Promise<void> =>
  new Promise((resolver, rechazar) => {
    servidor.close((error) => (error ? rechazar(error) : resolver()));
  });

export const levantarDobleIdentidad = async (): Promise<DobleIdentidad> => {
  const app = express();
  app.use(express.json());

  const usuarios = new Map<string, UsuarioFalso>();
  const llamadas: Array<{ metodo: string; ruta: string }> = [];
  let fallarCon: number | null = null;

  app.use((req, res, siguiente) => {
    llamadas.push({ metodo: req.method, ruta: req.originalUrl });
    if (fallarCon !== null) {
      return res.status(fallarCon).json({ mensaje: 'Doble caído a propósito' });
    }
    return siguiente();
  });

  app.use(
    '/interno',
    exigirServicio({
      destinatario: 'ms-identidad',
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
  );

  app.get('/interno/usuarios', (req, res) => {
    const { ids } = req.query as Record<string, string | undefined>;

    if (typeof ids !== 'string') {
      return res.status(400).json({ mensaje: 'Indica `ids`' });
    }

    // Los que no existen simplemente no salen, como en el real. NO se devuelve un
    // hueco ni un 404: el endpoint es un lote y la ausencia es un dato.
    const solicitados = ids
      .split(',')
      .map((id) => usuarios.get(id.trim()))
      .filter(Boolean);

    return res.json({ usuarios: solicitados });
  });

  const { servidor, url } = await escuchar(app);

  return {
    url,
    usuarios,
    llamadas,
    caer: (codigo = 503) => {
      fallarCon = codigo;
    },
    levantar: () => {
      fallarCon = null;
    },
    limpiarLlamadas: () => {
      llamadas.length = 0;
    },
    cerrar: () => cerrarServidor(servidor),
  };
};
