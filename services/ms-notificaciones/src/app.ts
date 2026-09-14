/**
 * MS-Notificaciones: aplicacion Express.
 *
 * Se exporta sin escuchar para que las pruebas la monten con supertest sin abrir un
 * puerto. El arranque real vive en `server.ts`.
 *
 * ── DOS RUTAS, Y NINGUNA ES PUBLICA ────────────────────────────────────────
 *
 * `GET /` es el healthcheck de Compose, igual que en los otros tres servicios.
 * `/interno/eventos` es la entrada del bus. No hay `/api` de ninguna clase, que es
 * lo que distingue a este servicio de los otros cuatro: no aparece en la costura de
 * enrutamiento del gateway ni tiene filas en la matriz RBAC.
 *
 * `cors()` se monta igual que en los demas por coherencia, aunque aqui no haga
 * falta: ningun navegador llama a este servicio. Quitarlo seria una diferencia
 * gratuita entre cinco archivos que conviene que se parezcan.
 */

import cors from 'cors';
import express, { type Express } from 'express';

import internoRoutes from './routes/interno.routes';

export const app: Express = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ servicio: 'ms-notificaciones', version: '0.0.0', estado: 'ok' });
});

app.use('/interno', internoRoutes);

export default app;
