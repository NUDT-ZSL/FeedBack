import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { createDeps, fixedClock } from './deps';
import { ApiError } from './errors';
import { AppState, createSeedState } from './state';
import {
  changeIronCertificate,
  computeMonthlyReport,
  createIronCertificate,
  createSaltCertificate,
  inspectSaltCertificate,
  listIronCertificates,
  listSaltCertificates,
} from './services';

export interface CreateAppOptions {
  seed?: number;
  fixedNow?: string;
  state?: AppState;
}

export function createApp(options: CreateAppOptions = {}) {
  const deps = createDeps({
    seed: options.seed,
    clock: options.fixedNow ? fixedClock(options.fixedNow) : undefined,
  });
  const state = options.state ?? createSeedState(deps);

  const app = express();
  app.use(cors());
  app.use(express.json());

  const asyncRoute = (handler: (req: Request, res: Response) => void) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        handler(req, res);
      } catch (error) {
        next(error);
      }
    };

  app.get('/api/salt-certificates', asyncRoute((req, res) => {
    const { search, sort } = req.query;
    res.json(listSaltCertificates(state, {
      search: typeof search === 'string' ? search : undefined,
      sort: sort === 'asc' || sort === 'desc' ? sort : undefined,
    }));
  }));

  app.post('/api/salt-certificates', asyncRoute((req, res) => {
    const { saltAmount, region, seal, secretMark } = req.body;
    const cert = createSaltCertificate(state, deps, { saltAmount, region, seal, secretMark });
    res.status(201).json(cert);
  }));

  app.put('/api/salt-certificates/:id', asyncRoute((req, res) => {
    const { status, inspector } = req.body;
    res.json(inspectSaltCertificate(state, deps, req.params.id, status, inspector));
  }));

  app.put('/api/salt-certificates/:id/inspect', asyncRoute((req, res) => {
    const { result, inspector } = req.body;
    res.json(inspectSaltCertificate(state, deps, req.params.id, result, inspector));
  }));

  app.get('/api/iron-certificates', asyncRoute((req, res) => {
    const { search, sort } = req.query;
    res.json(listIronCertificates(state, {
      search: typeof search === 'string' ? search : undefined,
      sort: sort === 'asc' || sort === 'desc' ? sort : undefined,
    }));
  }));

  app.post('/api/iron-certificates', asyncRoute((req, res) => {
    const { type, holderName, holderTitle, holderAvatar } = req.body;
    const cert = createIronCertificate(state, deps, { type, holderName, holderTitle, holderAvatar });
    res.status(201).json(cert);
  }));

  app.put('/api/iron-certificates/:id', asyncRoute((req, res) => {
    const { status, expiryDate } = req.body;
    res.json(changeIronCertificate(state, deps, req.params.id, status, expiryDate));
  }));

  app.get('/api/inspection-logs', asyncRoute((_req, res) => {
    res.json(state.inspectionLogs);
  }));

  app.get('/api/iron-cert-changes', asyncRoute((_req, res) => {
    res.json(state.ironCertChanges);
  }));

  app.get('/api/daily-stats', asyncRoute((_req, res) => {
    res.json(state.dailyStats);
  }));

  app.get('/api/report', asyncRoute((req, res) => {
    const { month } = req.query;
    if (!month || typeof month !== 'string') {
      throw new ApiError(400, 'INVALID_MONTH', '请指定月份参数，格式为YYYY-MM');
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new ApiError(400, 'INVALID_MONTH', '月份格式错误，应为YYYY-MM');
    }
    res.json(computeMonthlyReport(state, month));
  }));

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    res.status(500).json({ error: '服务器内部错误' });
  });

  return { app, state, deps };
}
