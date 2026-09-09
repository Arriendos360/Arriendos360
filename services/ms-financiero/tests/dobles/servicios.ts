/**
 * Dobles de MS-Contratos y MS-Identidad para las pruebas de MS-Financiero.
 *
 * Dobles HTTP y no mocks de funcion, siguiendo la convencion del paso 3: los
 * clientes piden por red, asi que para probarlos hace falta algo que escuche.
 * Ademas permiten simular lo incomodo —que el otro extremo no responda, que
 * devuelva un contrato de otro propietario— sin tocar el codigo de produccion.
 *
 * EXIGEN LA CREDENCIAL DE SERVICIO, igual que los reales. Si no lo hicieran, las
 * suites pasarian aunque el cliente olvidara mandarla, que es exactamente el
 * fallo que estos dobles tienen que poder atrapar.
 *
 * ── EL DE CONTRATOS RESUELVE LA PERTENENCIA COMO EL REAL ────────────────────
 *
 * Es la pieza mas importante de este archivo. Toda la autorizacion de
 * ms-financiero depende de «¿este contrato es suyo?», y el servicio real NO
 * guarda `id_propietario` en el contrato: se lo pregunta a ms-inmuebles cada
 * vez. El doble hace lo mismo con un mapa de inmuebles.
 *
 * No es comodidad. Si el doble decidiera la pertenencia con una regla propia
 * —un `id_propietario` guardado en el contrato— las suites pasarian en verde
 * contra un comportamiento que el servicio real no tiene, y taparian justo la
 * decision del paso 6d. Ver `docs/adr/0017`.
 *
 * ── Y COMPONE EL INMUEBLE, PORQUE EL REAL LO COMPONE ────────────────────────
 *
 * `?incluir=inmueble` adjunta el `Inmueble` de cada contrato. Es de lo que
 * dependen el motor —que avisa al propietario— y los comprobantes —que imprimen
 * la direccion—, y sobre todo es lo que sostiene la garantia del viaje unico: si
 * el doble no lo compusiera, la prueba de que el barrido hace DOS peticiones y
 * no tres no significaria nada.
 */

import express from 'express';
import type { Server } from 'http';
import { exigirServicio } from 'arriendos360-shared';
import type { EntradaRevocada, EntradaSesion } from 'arriendos360-shared';

export interface InmuebleFalso {
  id_inmueble: string;
  id_propietario: string;
  direccion?: string;
  barrio?: string;
  municipio?: string;
  tipo?: string;
  estado?: string;
}

export interface ContratoFalso {
  id_contrato: string;
  id_inmueble: string;
  id_inquilino: string;
  canon: number;
  fecha_inicio_corte: string;
  fecha_limite_pago?: number;
  estado: string;
  [clave: string]: unknown;
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

export interface DobleContratos {
  url: string;
  contratos: Map<string, ContratoFalso>;
  /** De quien es cada inmueble. Es lo que resuelve la pertenencia, como el real. */
  inmuebles: Map<string, InmuebleFalso>;
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

export const levantarDobleContratos = async (): Promise<DobleContratos> => {
  const app = express();
  app.use(express.json());

  const contratos = new Map<string, ContratoFalso>();
  const inmuebles = new Map<string, InmuebleFalso>();
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
      destinatario: 'ms-contratos',
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
  );

  // ── Pertenencia, resuelta como en el servicio real ─────────────────────────
  const inmueblesDe = (sub: string): string[] =>
    [...inmuebles.values()].filter((i) => i.id_propietario === sub).map((i) => i.id_inmueble);

  const esPropietarioDe = (contrato: ContratoFalso, sub: string): boolean =>
    inmueblesDe(sub).includes(contrato.id_inmueble);

  const esParteDe = (contrato: ContratoFalso, sub: string): boolean =>
    contrato.id_inquilino === sub || esPropietarioDe(contrato, sub);

  /** `?incluir=inmueble`: adjunta el inmueble, como hace el servicio real. */
  const conPartes = (req: express.Request, lista: ContratoFalso[]): unknown[] =>
    req.query['incluir'] === 'inmueble'
      ? lista.map((c) => ({ ...c, Inmueble: inmuebles.get(c.id_inmueble) ?? null }))
      : lista;

  app.get('/interno/contratos', (req, res) => {
    const { parte, propietario, inquilino, ids, inmueble, estado } = req.query as Record<
      string,
      string | undefined
    >;
    const todos = [...contratos.values()];

    if (parte) {
      return res.json({ contratos: conPartes(req, todos.filter((c) => esParteDe(c, parte))) });
    }

    if (propietario) {
      return res.json({
        contratos: conPartes(req, todos.filter((c) => esPropietarioDe(c, propietario))),
      });
    }

    if (inquilino) {
      return res.json({
        contratos: conPartes(req, todos.filter((c) => c.id_inquilino === inquilino)),
      });
    }

    if (inmueble) {
      return res.json({
        contratos: conPartes(
          req,
          todos.filter((c) => c.id_inmueble === inmueble && (!estado || c.estado === estado)),
        ),
      });
    }

    if (typeof ids === 'string') {
      const solicitados = ids
        .split(',')
        .map((id) => contratos.get(id.trim()))
        .filter(Boolean) as ContratoFalso[];

      return res.json({ contratos: conPartes(req, solicitados) });
    }

    if (estado) {
      return res.json({ contratos: conPartes(req, todos.filter((c) => c.estado === estado)) });
    }

    return res.status(400).json({ mensaje: 'Indica un filtro' });
  });

  app.get('/interno/contratos/:id', (req, res) => {
    const contrato = contratos.get(req.params['id'] as string);
    const { propietario } = req.query as Record<string, string | undefined>;

    if (!contrato) {
      return res.status(404).json({ mensaje: 'Contrato no encontrado' });
    }

    // Con `?propietario=`, 404 si no es suyo: es la comprobacion de pertenencia
    // que el servicio real hace preguntandole a ms-inmuebles.
    if (propietario && !esPropietarioDe(contrato, propietario)) {
      return res.status(404).json({ mensaje: 'Contrato no encontrado' });
    }

    return res.json({ contrato });
  });

  const { servidor, url } = await escuchar(app);

  return {
    url,
    contratos,
    inmuebles,
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

export interface DobleIdentidad {
  url: string;
  usuarios: Map<string, UsuarioFalso>;
  revocados: EntradaRevocada[];
  sesiones: EntradaSesion[];
  llamadas: Array<{ metodo: string; ruta: string }>;
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

  app.get('/interno/revocados', (_req, res) => res.json({ revocados, sesiones }));

  app.get('/interno/usuarios', (req, res) => {
    const { ids } = req.query as Record<string, string | undefined>;

    if (typeof ids !== 'string') {
      return res.status(400).json({ mensaje: 'Indica `ids`' });
    }

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
    revocados,
    sesiones,
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
