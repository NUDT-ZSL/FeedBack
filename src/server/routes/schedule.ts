import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { store, persistStore } from '../data/store.js';
import { Schedule } from '../types/index.js';
import { checkTimeConflict, formatConflictMessage, validateTimeGranularity } from '../utils/conflict.js';

interface ClientInfo {
  ws: any;
  subscribedBandIds: Set<string>;
}

let wss: any;
const clients: Map<any, ClientInfo> = new Map();

export function setWebSocketServer(wsServer: any) {
  wss = wsServer;
}

function notifySubscribers(message: { type: string; data: any }, relatedBandId?: string) {
  if (!wss || !wss.clients) return;

  wss.clients.forEach((client: any) => {
    if (client.readyState !== 1) return;

    const clientInfo = clients.get(client);
    if (!clientInfo) return;

    if (!relatedBandId || clientInfo.subscribedBandIds.has(relatedBandId)) {
      client.send(JSON.stringify(message));
    }
  });
}

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { stage } = req.query;
  let schedules = store.schedules;

  if (stage && typeof stage === 'string') {
    schedules = schedules.filter(s => s.stage === stage);
  }

  schedules.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  res.json(schedules);
});

router.get('/:id', (req: Request, res: Response) => {
  const schedule = store.schedules.find(s => s.id === req.params.id);
  if (!schedule) {
    return res.status(404).json({ message: '排期不存在' });
  }
  res.json(schedule);
});

router.post('/', (req: Request, res: Response) => {
  const { bandId, stage, startTime, endTime } = req.body;

  if (!bandId || !stage || !startTime || !endTime) {
    return res.status(400).json({ message: '请填写完整信息' });
  }

  const granularityError = validateTimeGranularity(startTime, endTime);
  if (granularityError) {
    return res.status(400).json({ message: granularityError });
  }

  const band = store.bands.find(b => b.id === bandId);
  if (!band) {
    return res.status(404).json({ message: '乐队不存在' });
  }

  if (band.status !== 'approved') {
    return res.status(400).json({ message: '该乐队未通过审核，无法安排排期' });
  }

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (start >= end) {
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const nextDayEnd = new Date(endDate);
    nextDayEnd.setDate(nextDayEnd.getDate() + 1);
    if (nextDayEnd.getTime() <= start) {
      return res.status(400).json({ message: '结束时间必须晚于开始时间' });
    }
  }

  const conflict = checkTimeConflict(store.schedules, stage, startTime, endTime);
  if (conflict) {
    return res.status(400).json({
      message: formatConflictMessage(conflict),
      conflict
    });
  }

  const newSchedule: Schedule = {
    id: uuidv4(),
    bandId,
    bandName: band.name,
    stage,
    startTime,
    endTime,
    genres: band.genres
  };

  store.schedules.push(newSchedule);
  persistStore();

  notifySubscribers(
    { type: 'schedule_create', data: newSchedule },
    bandId
  );

  res.status(201).json(newSchedule);
});

router.put('/:id', (req: Request, res: Response) => {
  const scheduleIndex = store.schedules.findIndex(s => s.id === req.params.id);
  if (scheduleIndex === -1) {
    return res.status(404).json({ message: '排期不存在' });
  }

  const { stage, startTime, endTime } = req.body;
  const schedule = store.schedules[scheduleIndex];

  const checkStage = stage || schedule.stage;
  const checkStart = startTime || schedule.startTime;
  const checkEnd = endTime || schedule.endTime;

  if (startTime || endTime) {
    const granularityError = validateTimeGranularity(checkStart, checkEnd);
    if (granularityError) {
      return res.status(400).json({ message: granularityError });
    }
  }

  const conflict = checkTimeConflict(
    store.schedules,
    checkStage,
    checkStart,
    checkEnd,
    schedule.id
  );

  if (conflict) {
    return res.status(400).json({
      message: formatConflictMessage(conflict),
      conflict
    });
  }

  if (stage) schedule.stage = stage;
  if (startTime) schedule.startTime = startTime;
  if (endTime) schedule.endTime = endTime;

  persistStore();

  notifySubscribers(
    { type: 'schedule_update', data: schedule },
    schedule.bandId
  );

  res.json(schedule);
});

router.delete('/:id', (req: Request, res: Response) => {
  const scheduleIndex = store.schedules.findIndex(s => s.id === req.params.id);
  if (scheduleIndex === -1) {
    return res.status(404).json({ message: '排期不存在' });
  }

  const deletedSchedule = store.schedules[scheduleIndex];
  const deletedBandId = deletedSchedule.bandId;
  const deletedId = deletedSchedule.id;
  store.schedules.splice(scheduleIndex, 1);
  persistStore();

  notifySubscribers(
    { type: 'schedule_delete', data: { id: deletedId, bandId: deletedBandId } },
    deletedBandId
  );

  res.json({ message: '排期已删除' });
});

export function registerClient(ws: any) {
  clients.set(ws, { ws, subscribedBandIds: new Set() });
}

export function unregisterClient(ws: any) {
  clients.delete(ws);
}

export function updateClientSubscriptions(ws: any, bandIds: string[]) {
  const clientInfo = clients.get(ws);
  if (clientInfo) {
    clientInfo.subscribedBandIds = new Set(bandIds);
  }
}

export default router;
