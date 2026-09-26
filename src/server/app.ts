// Express应用工厂 - 从index.ts抽离，便于自动化测试在随机端口复用应用
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import courseRoutes from './routes/courses';
import qrCodeRoutes from './routes/qrcode';

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', courseRoutes);
  app.use('/api', qrCodeRoutes);

  app.use('*', (_req, res) => {
    res.status(404).json({ message: '接口不存在' });
  });

  return app;
};
