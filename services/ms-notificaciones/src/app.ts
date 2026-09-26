/**
 * MS-Notificaciones: aplicación Express, exportada sin escuchar para las pruebas.
 * Sólo expone `GET /` (healthcheck) y `/interno/eventos`.
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
