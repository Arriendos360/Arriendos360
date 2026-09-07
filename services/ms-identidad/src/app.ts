/**
 * MS-Identidad: aplicacion Express.
 *
 * Se exporta sin escuchar para que las pruebas la monten con supertest sin
 * abrir un puerto. El arranque real vive en `server.ts`.
 */

import cors from 'cors';
import express, { type Express } from 'express';

import authRoutes from './routes/auth.routes';
import internoRoutes from './routes/interno.routes';
import usuarioRoutes from './routes/usuario.routes';

export const app: Express = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ servicio: 'ms-identidad', version: '0.0.0', estado: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/interno', internoRoutes);

export default app;
