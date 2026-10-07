/**
 * 驿站调度 HTTP 服务（薄路由层）。
 * 所有状态流转由 server/core.js 统一处理，本文件只做参数解析与错误映射。
 *
 * 可用环境变量（便于离线/快速验证）：
 *   PORT             服务端口，默认 3001
 *   TIME_SCALE       运输时间倍率，默认 1（如 0.001 表示 60 分钟路程 3.6 秒到达）
 *   REST_COOLDOWN_MS 马匹休息冷却毫秒数，默认 30000
 */
import express from 'express';
import cors from 'cors';
import { createStation, DomainError } from './server/core.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const TIME_SCALE = Number(process.env.TIME_SCALE) || 1;
const REST_COOLDOWN_MS = Number(process.env.REST_COOLDOWN_MS) || 30000;

app.use(cors());
app.use(express.json());

let station;

const ok = (res, data) => res.json({ success: true, data });

function handle(res, fn) {
  try {
    return ok(res, fn());
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
}

app.get('/api/letters', (req, res) => handle(res, () => station.listLetters()));
app.post('/api/letters', (req, res) => handle(res, () => station.addLetter(req.body)));
app.delete('/api/letters/:id', (req, res) => handle(res, () => {
  station.deleteLetter(req.params.id);
  return { id: req.params.id };
}));
// 信件状态只能由派单/到达/回退流程驱动，拒绝直接改写，避免与任务、马匹状态脱节。
app.put('/api/letters/:id', (req, res) => res.status(400).json({
  success: false,
  error: '信件状态由派单、到达、回退流程自动流转，不支持直接修改',
  code: 'STATUS_NOT_EDITABLE',
}));

app.get('/api/horses', (req, res) => handle(res, () => station.listHorses()));
app.post('/api/horses/:id/rest', (req, res) => handle(res, () => station.restHorse(req.params.id)));
app.put('/api/horses/:id', (req, res) => res.status(400).json({
  success: false,
  error: '马匹状态由派单、到达、休息冷却流程自动流转，不支持直接修改',
  code: 'STATUS_NOT_EDITABLE',
}));

app.get('/api/tasks', (req, res) => handle(res, () => station.listTasks()));
app.post('/api/tasks', (req, res) => handle(res, () => station.dispatchTask(req.body)));
app.post('/api/tasks/:id/arrive', (req, res) =>
  handle(res, () => station.reportArrival(req.params.id, req.body?.actualArrivalTime)));
app.post('/api/tasks/:id/rollback', (req, res) => handle(res, () => station.rollbackTask(req.params.id)));
// 兼容旧的 PUT 入口：status=cancelled 视为回退，否则视为上报到达；不再允许任意改写状态。
app.put('/api/tasks/:id', (req, res) => handle(res, () => {
  if (req.body?.status === 'cancelled') return station.rollbackTask(req.params.id);
  return station.reportArrival(req.params.id, req.body?.actualArrivalTime);
}));
app.get('/api/tasks/history', (req, res) => handle(res, () => station.listHistory(
  parseInt(req.query.page, 10) || 1,
  parseInt(req.query.limit, 10) || 20,
)));

app.get('/api/statistics', (req, res) => handle(res, () => station.getStatistics()));
app.get('/api/fleets', (req, res) => handle(res, () => station.listFleets()));

createStation({ timeScale: TIME_SCALE, restCooldownMs: REST_COOLDOWN_MS }).then((s) => {
  station = s;
  // 定时对账：到点自动结算任务、冷却到期自动恢复马匹；读接口也会各自对账。
  setInterval(() => station.reconcile(), 1000);
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (TIME_SCALE=${TIME_SCALE}, REST_COOLDOWN_MS=${REST_COOLDOWN_MS})`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
