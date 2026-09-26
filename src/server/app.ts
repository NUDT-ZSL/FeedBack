import express from 'express';
import cors from 'cors';
import evaluationsRouter from './routes/evaluations.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use('/api/evaluations', evaluationsRouter);

  return app;
}
