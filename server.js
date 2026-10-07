/**
 * server.js — Express 后端，只负责 HTTP 接线。
 * 数据流向：接收前端 HTTP 请求 → 调用 lifecycle.mjs 中的状态机 → 返回 JSON 响应。
 * 所有信件/马匹/任务的状态流转规则都收敛在 lifecycle.mjs，本文件不做业务判断。
 */
import express from 'express';
import cors from 'cors';
import { createDatabase, createStore, LifecycleError } from './lifecycle.mjs';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let store;

/** 每次 API 请求前先推进时钟，保证任何视图读到的都是当前时刻的事实。 */
app.use('/api', (req, res, next) => {
  try {
    store.sweep(Date.now());
  } catch (err) {
    console.error('sweep failed:', err);
  }
  next();
});

function handle(res, fn) {
  try {
    const data = fn();
    res.json(data === undefined ? { success: true } : { success: true, data });
  } catch (err) {
    if (err instanceof LifecycleError) {
      res.status(err.httpStatus).json({ success: false, error: err.message, code: err.code });
    } else {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

app.get('/api/letters', (req, res) => handle(res, () => store.listLetters()));

app.post('/api/letters', (req, res) =>
  handle(res, () => store.createLetter(req.body, Date.now()))
);

app.delete('/api/letters/:id', (req, res) =>
  handle(res, () => store.deleteLetter(req.params.id))
);

app.get('/api/horses', (req, res) => handle(res, () => store.listHorses()));

app.post('/api/horses/:id/rest', (req, res) =>
  handle(res, () => store.restHorse(req.params.id, Date.now()))
);

app.get('/api/tasks', (req, res) => handle(res, () => store.listTasks()));

app.post('/api/tasks', (req, res) =>
  handle(res, () => store.dispatch(req.body.letterId, req.body.horseId, Date.now()))
);

app.get('/api/tasks/history', (req, res) =>
  handle(res, () =>
    store.taskHistory(parseInt(req.query.page) || 1, parseInt(req.query.limit) || 20)
  )
);

app.put('/api/tasks/:id', (req, res) =>
  handle(res, () => store.settleTask(req.params.id, Date.now(), req.body.actualArrivalTime))
);

app.get('/api/statistics', (req, res) => handle(res, () => store.statistics(Date.now())));

app.get('/api/fleets', (req, res) => handle(res, () => store.listFleets()));

createDatabase()
  .then((db) => {
    store = createStore(db);
    // 定时推进时钟：抵达结算与冷却释放不依赖任何前端触发。
    setInterval(() => {
      try {
        store.sweep(Date.now());
      } catch (err) {
        console.error('sweep failed:', err);
      }
    }, 1000);
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
