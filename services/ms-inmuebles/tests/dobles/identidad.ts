/**
 * Doble de ms-identidad para las pruebas de ms-inmuebles.
 *
 * Un doble HTTP y no un mock de funcion, siguiendo la convencion del paso 3:
 * el cliente pide por red, asi que para probarlo hace falta algo que escuche.
 * Ademas permite simular lo incomodo — que el otro extremo no responda, que
 * devuelva la lista vacia — sin tocar el codigo de produccion.
 *
 * EXIGE LA CREDENCIAL DE SERVICIO, igual que el real. Si no lo hiciera, las
 * suites pasarian aunque el cliente olvidara mandarla, que es exactamente el
 * fallo que este doble tiene que poder atrapar.
 */

import express from 'express';
import type { Server } from 'http';
import { exigirServicio } from 'arriendos360-shared';
import type { EntradaRevocada, EntradaSesion } from 'arriendos360-shared';

export interface DobleIdentidad {
  url: string;
  /** `jti` que el doble reporta como revocados. Mutable entre pruebas. */
  revocados: EntradaRevocada[];
  /** Sesiones caidas que reporta. Mutable entre pruebas. */
  sesiones: EntradaSesion[];
  /** Cuantas veces le han pedido la lista. */
  llamadas: number;
  cerrar: () => Promise<void>;
}

export const levantarDobleIdentidad = async (): Promise<DobleIdentidad> => {
  const app = express();

  const estado = {
    revocados: [] as EntradaRevocada[],
    sesiones: [] as EntradaSesion[],
    llamadas: 0,
  };

  app.use(
    '/interno',
    exigirServicio({
      destinatario: 'ms-identidad',
      secreto: process.env['SERVICIO_JWT_SECRET'],
    }),
  );

  app.get('/interno/revocados', (_req, res) => {
    estado.llamadas += 1;
    res.json({
      revocados: estado.revocados,
      sesiones: estado.sesiones,
      generado_en: new Date().toISOString(),
    });
  });

  const servidor: Server = await new Promise((resolver) => {
    const s = app.listen(0, () => resolver(s));
  });

  const puerto = (servidor.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    get revocados() {
      return estado.revocados;
    },
    set revocados(valor: EntradaRevocada[]) {
      estado.revocados = valor;
    },
    get sesiones() {
      return estado.sesiones;
    },
    set sesiones(valor: EntradaSesion[]) {
      estado.sesiones = valor;
    },
    get llamadas() {
      return estado.llamadas;
    },
    cerrar: () =>
      new Promise<void>((resolver, rechazar) => {
        servidor.close((error) => (error ? rechazar(error) : resolver()));
      }),
  };
};
