/**
 * MS-Contratos: aplicacion Express.
 *
 * Se exporta sin escuchar para que las pruebas la monten con supertest sin abrir
 * un puerto. El arranque real vive en `server.ts`.
 */

import cors from 'cors';
import express, { type Express } from 'express';

import contratoRoutes from './routes/contrato.routes';
import internoRoutes from './routes/interno.routes';

export const app: Express = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ servicio: 'ms-contratos', version: '0.0.0', estado: 'ok' });
});

app.use('/api/contratos', contratoRoutes);
app.use('/interno', internoRoutes);

export default app;
