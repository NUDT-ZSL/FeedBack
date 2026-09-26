import express from 'express';
import cors from 'cors';
import { Evaluation } from './types.js';
import { createEvaluationsRouter } from './routes/evaluations.js';

export function createApp(initialEvaluations?: Evaluation[]) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use('/api/evaluations', createEvaluationsRouter(initialEvaluations));

  return app;
}
