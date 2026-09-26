/**
 * Dobles de MS-Inmuebles y MS-Identidad para las pruebas de MS-Contratos.
 *
 * Dobles HTTP y no mocks de funcion, siguiendo la convencion del paso 3: los
 * clientes piden por red, asi que para probarlos hace falta algo que escuche.
 * Ademas permiten simular lo incomodo —que el otro extremo no responda— sin
 * tocar el codigo de produccion.
 *
 * EXIGEN LA CREDENCIAL DE SERVICIO, igual que los reales. Si no lo hicieran, las
 * suites pasarian aunque el cliente olvidara mandarla, que es exactamente el
 * fallo que estos dobles tienen que poder atrapar.
 *
 * ── EL DE INMUEBLES ES EL QUE DECIDE LA PERTENENCIA ─────────────────────────
 *
 * Es la pieza mas importante de este archivo. Este servicio NO guarda
 * `id_propietario` en el contrato: se lo pregunta a Inmuebles cada vez. Asi que
 * cambiar de dueño un inmueble en este doble tiene que cambiar quien puede ver
 * el contrato — y eso es justamente lo que una de las pruebas comprueba, porque
 * es la razon por la que no se denormalizo. Ver `docs/adr/0017`.
 */

import express from 'express';
import type { Server } from 'http';
import { exigirServicio } from 'arriendos360-shared';
import type { EntradaRevocada, EntradaSesion } from 'arriendos360-shared';

export interface InmuebleFalso {
  id_inmueble: string;
  id_propietario: string;
  direccion?: string;
  alias?: string;
  ciudad?: string;
  tipo?: string;
  estado?: string;
}

export interface UsuarioFalso {
  id: string;
  nombres?: string;
  apellidos?: string;
  email?: string;
  documento?: string;
  telefono?: string;
  roles?: string[];
}

export interface DobleInmuebles {
  url: string;
  inmuebles: Map<string, InmuebleFalso>;
  /** Sobres recibidos por `/interno/eventos`, repetidos incluidos. */
  eventos: Array<{ id_evento: string; tipo: string; payload: Record<string, unknown> }>;
  llamadas: Array<{ metodo: string; ruta: string }>;
  /** Hace fallar las peticiones, para probar la politica de fallo del cliente. */
  caer: (codigo?: number) => void;
  levantar: () => void;
  limpiarLlamadas: () => void;
  cerrar: () => Promise<void>;
}

export const levantarDobleInmuebles = async (): Promise<DobleInmuebles> => {
  const app = express();
  app.use(express.json());
  const inmuebles = new Map<string, InmuebleFalso>();
  const eventos: Array<{ id_evento: string; tipo: string; payload: Record<string, unknown> }> = [];
  const procesados = new Set<string>();
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
      destinatario: 'ms-inmuebles',
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
  );

  app.get('/interno/inmuebles', (req, res) => {
    const { propietario, ids } = req.query;

    if (typeof propietario === 'string' && propietario !== '') {
      return res.json({
        inmuebles: [...inmuebles.values()].filter((i) => i.id_propietario === propietario),
      });
    }

    if (typeof ids === 'string') {
      return res.json({
        inmuebles: ids
          .split(',')
          .map((id) => inmuebles.get(id.trim()))
          .filter(Boolean),
      });
    }

    return res.status(400).json({ mensaje: 'Indica `propietario` o `ids`' });
  });

  /**
   * La entrada del bus, con las DOS cosas que hace el servicio real: descartar
   * repetidos por `id_evento` y aplicar el efecto.
   *
   * Si solo hiciera lo segundo, un productor que reentregara —que con entrega
   * al-menos-una-vez no es una posibilidad remota, es una certeza— pasaria esta
   * suite en verde.
   */
  const POR_TIPO: Record<string, string> = {
    ContratoFormalizado: 'arrendado',
    ContratoFinalizado: 'disponible',
  };

  app.post('/interno/eventos', (req, res) => {
    const sobre = req.body as {
      id_evento?: string;
      tipo?: string;
      payload?: Record<string, unknown>;
    };

    if (!sobre.id_evento || !sobre.tipo || typeof sobre.payload !== 'object') {
      return res.status(400).json({ mensaje: 'Sobre de evento mal formado' });
    }

    eventos.push(sobre as { id_evento: string; tipo: string; payload: Record<string, unknown> });

    if (procesados.has(sobre.id_evento)) {
      return res.json({ mensaje: 'Evento ya procesado', repetido: true });
    }

    const estado = POR_TIPO[sobre.tipo];
    if (!estado) {
      return res.json({ mensaje: 'Evento sin manejador en este servicio', ignorado: true });
    }

    procesados.add(sobre.id_evento);

    const inmueble = inmuebles.get(sobre.payload['id_inmueble'] as string);
    if (inmueble) {
      inmueble.estado = estado;
    }

    return res.json({ mensaje: 'Evento procesado', repetido: false });
  });

  const servidor: Server = await new Promise((resolver) => {
    const s = app.listen(0, () => resolver(s));
  });

  const puerto = (servidor.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    inmuebles,
    eventos,
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
    cerrar: () =>
      new Promise((resolver, rechazar) => {
        servidor.close((error) => (error ? rechazar(error) : resolver()));
      }),
  };
};

export interface DobleIdentidad {
  url: string;
  usuarios: Map<string, UsuarioFalso>;
  revocados: EntradaRevocada[];
  sesiones: EntradaSesion[];
  llamadas: Array<{ metodo: string; ruta: string }>;
  /** Contraseñas temporales reemitidas, para afirmar sobre la llamada. */
  reemisiones: Array<{ id: string; solicitado_por: string }>;
  caer: (codigo?: number) => void;
  levantar: () => void;
  limpiarLlamadas: () => void;
  cerrar: () => Promise<void>;
}

export const levantarDobleIdentidad = async (): Promise<DobleIdentidad> => {
  const app = express();
  app.use(express.json());

  const usuarios = new Map<string, UsuarioFalso>();
  const revocados: EntradaRevocada[] = [];
  const sesiones: EntradaSesion[] = [];
  const llamadas: Array<{ metodo: string; ruta: string }> = [];
  const reemisiones: Array<{ id: string; solicitado_por: string }> = [];
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

  app.get('/interno/revocados', (_req, res) => {
    res.json({ revocados, sesiones, generado_en: new Date().toISOString() });
  });

  app.get('/interno/usuarios', (req, res) => {
    const { ids } = req.query;

    if (typeof ids !== 'string') {
      return res.status(400).json({ mensaje: 'Indica `ids`' });
    }

    return res.json({
      usuarios: ids
        .split(',')
        .map((id) => usuarios.get(id.trim()))
        .filter(Boolean),
    });
  });

  app.post('/interno/usuarios/:id/contrasena-temporal', (req, res) => {
    const usuario = usuarios.get(req.params.id as string);

    if (!usuario) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    reemisiones.push({
      id: usuario.id,
      solicitado_por: (req.body as { solicitado_por: string }).solicitado_por,
    });

    return res.json({ contrasena_temporal: 'Temp0ral!', usuario });
  });

  const servidor: Server = await new Promise((resolver) => {
    const s = app.listen(0, () => resolver(s));
  });

  const puerto = (servidor.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    usuarios,
    revocados,
    sesiones,
    llamadas,
    reemisiones,
    caer: (codigo = 503) => {
      fallarCon = codigo;
    },
    levantar: () => {
      fallarCon = null;
    },
    limpiarLlamadas: () => {
      llamadas.length = 0;
    },
    cerrar: () =>
      new Promise((resolver, rechazar) => {
        servidor.close((error) => (error ? rechazar(error) : resolver()));
      }),
  };
};
