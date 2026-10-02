import express, { Request, Response } from 'express';
import cors from 'cors';

type DocumentLevel = '步递' | '马递' | '急脚递';
type SecurityLevel = '普通' | '机密' | '绝密';
type DocumentStatus = '待分拣' | '已分拣' | '派送中' | '已送达' | '延误';
type HorseStatus = '空闲' | '在役' | '疲惫' | '休息中';

interface Document {
  id: string;
  origin: string;
  destination: string;
  level: DocumentLevel;
  securityLevel: SecurityLevel;
  copies: number;
  status: DocumentStatus;
  receivedAt: Date;
  sortedAt?: Date;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  deadline: Date;
  currentStation: number;
  totalStations: number;
  assignedHorseId?: string;
  assignedSoldierId?: string;
  isUrgent: boolean;
}

interface Horse {
  id: string;
  name: string;
  health: number;
  stamina: number;
  maxStamina: number;
  status: HorseStatus;
  age: number;
  maxLoad: number;
  totalMileage: number;
  currentStation: number;
}

interface Soldier {
  id: string;
  name: string;
  status: '空闲' | '在役' | '休息';
  assignments: number;
}

interface LogEntry {
  id: string;
  timestamp: Date;
  action: string;
  documentId?: string;
  horseId?: string;
  level: 'info' | 'warning' | 'error';
}

interface Dispatch {
  id: string;
  documentId: string;
  horseId: string;
  soldierId: string;
  startTime: Date;
  estimatedArrival: Date;
  status: '进行中' | '完成' | '延误';
}

const generateId = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const calculateDeadline = (level: DocumentLevel, receivedAt: Date): Date => {
  const hours = level === '步递' ? 4 : level === '马递' ? 2 : 1;
  return new Date(receivedAt.getTime() + hours * 60 * 60 * 1000);
};

const calculateTotalStations = (origin: string, destination: string): number => {
  const hash = origin.length + destination.length;
  return Math.max(3, Math.min(15, hash));
};

const locations = [
  '开封府', '洛阳城', '长安城', '应天府', '大名府',
  '杭州城', '苏州城', '扬州城', '成都府', '江陵府',
  '襄阳城', '潭州城', '福州城', '广州城', '桂州城',
  '太原府', '真定府', '京兆府', '凤翔府', '河中府'
];

const initialHorses: Horse[] = [
  { id: 'h1', name: '赤兔', health: 95, stamina: 100, maxStamina: 100, status: '空闲', age: 8, maxLoad: 150, totalMileage: 5000, currentStation: 0 },
  { id: 'h2', name: '的卢', health: 88, stamina: 100, maxStamina: 100, status: '空闲', age: 7, maxLoad: 140, totalMileage: 4200, currentStation: 0 },
  { id: 'h3', name: '乌骓', health: 92, stamina: 100, maxStamina: 100, status: '空闲', age: 6, maxLoad: 160, totalMileage: 3800, currentStation: 0 },
  { id: 'h4', name: '绝影', health: 85, stamina: 100, maxStamina: 100, status: '空闲', age: 9, maxLoad: 130, totalMileage: 6100, currentStation: 0 },
  { id: 'h5', name: '爪黄飞电', health: 90, stamina: 100, maxStamina: 100, status: '空闲', age: 5, maxLoad: 145, totalMileage: 2500, currentStation: 0 },
  { id: 'h6', name: '照夜玉狮子', health: 87, stamina: 100, maxStamina: 100, status: '空闲', age: 7, maxLoad: 135, totalMileage: 3900, currentStation: 0 },
  { id: 'h7', name: '乌云踏雪', health: 93, stamina: 100, maxStamina: 100, status: '空闲', age: 6, maxLoad: 155, totalMileage: 3200, currentStation: 0 },
  { id: 'h8', name: '赤兔驹', health: 78, stamina: 100, maxStamina: 100, status: '空闲', age: 10, maxLoad: 125, totalMileage: 7200, currentStation: 0 },
  { id: 'h9', name: '黄骠马', health: 91, stamina: 100, maxStamina: 100, status: '空闲', age: 5, maxLoad: 140, totalMileage: 2100, currentStation: 0 },
  { id: 'h10', name: '白龙驹', health: 86, stamina: 100, maxStamina: 100, status: '空闲', age: 8, maxLoad: 130, totalMileage: 4500, currentStation: 0 },
];

const initialSoldiers: Soldier[] = [
  { id: 's1', name: '张三', status: '空闲', assignments: 0 },
  { id: 's2', name: '李四', status: '空闲', assignments: 0 },
  { id: 's3', name: '王五', status: '空闲', assignments: 0 },
  { id: 's4', name: '赵六', status: '空闲', assignments: 0 },
  { id: 's5', name: '钱七', status: '空闲', assignments: 0 },
];

const documents: Document[] = [];
const horses: Horse[] = [...initialHorses];
const soldiers: Soldier[] = [...initialSoldiers];
const logs: LogEntry[] = [];
const dispatches: Dispatch[] = [];
let urgentCount = 3;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/documents', (req: Request, res: Response) => {
  res.json(documents);
});

app.post('/api/documents', (req: Request, res: Response) => {
  const body = req.body as Partial<Document>;
  const now = new Date();
  const totalStations = calculateTotalStations(body.origin || locations[0], body.destination || locations[1]);
  const newDocument: Document = {
    id: generateId(),
    origin: body.origin || locations[Math.floor(Math.random() * locations.length)],
    destination: body.destination || locations[Math.floor(Math.random() * locations.length)],
    level: body.level || '步递',
    securityLevel: body.securityLevel || '普通',
    copies: body.copies || 1,
    status: '待分拣',
    receivedAt: now,
    deadline: calculateDeadline(body.level || '步递', now),
    currentStation: 0,
    totalStations,
    isUrgent: false,
    ...body
  };
  documents.push(newDocument);
  logs.push({
    id: generateId(),
    timestamp: now,
    action: `创建新公文，从${newDocument.origin}到${newDocument.destination}`,
    documentId: newDocument.id,
    level: 'info'
  });
  res.json(newDocument);
});

app.put('/api/documents/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const index = documents.findIndex(d => d.id === id);
  if (index === -1) {
    res.status(404).json({ error: '公文不存在' });
    return;
  }
  documents[index] = { ...documents[index], ...req.body };
  logs.push({
    id: generateId(),
    timestamp: new Date(),
    action: '更新公文信息',
    documentId: id,
    level: 'info'
  });
  res.json(documents[index]);
});

app.delete('/api/documents/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const index = documents.findIndex(d => d.id === id);
  if (index === -1) {
    res.status(404).json({ error: '公文不存在' });
    return;
  }
  documents.splice(index, 1);
  logs.push({
    id: generateId(),
    timestamp: new Date(),
    action: '删除公文',
    documentId: id,
    level: 'warning'
  });
  res.json({ success: true });
});

app.get('/api/documents/generate', (req: Request, res: Response) => {
  const count = Math.floor(Math.random() * 3) + 1;
  const newDocuments: Document[] = [];
  const levels: DocumentLevel[] = ['步递', '马递', '急脚递'];
  const securityLevels: SecurityLevel[] = ['普通', '机密', '绝密'];

  for (let i = 0; i < count; i++) {
    const originIdx = Math.floor(Math.random() * locations.length);
    let destIdx = Math.floor(Math.random() * locations.length);
    while (destIdx === originIdx) {
      destIdx = Math.floor(Math.random() * locations.length);
    }
    const now = new Date();
    const level = levels[Math.floor(Math.random() * levels.length)];
    const totalStations = calculateTotalStations(locations[originIdx], locations[destIdx]);
    const doc: Document = {
      id: generateId(),
      origin: locations[originIdx],
      destination: locations[destIdx],
      level,
      securityLevel: securityLevels[Math.floor(Math.random() * securityLevels.length)],
      copies: Math.floor(Math.random() * 5) + 1,
      status: '待分拣',
      receivedAt: now,
      deadline: calculateDeadline(level, now),
      currentStation: 0,
      totalStations,
      isUrgent: false
    };
    documents.push(doc);
    newDocuments.push(doc);
    logs.push({
      id: generateId(),
      timestamp: now,
      action: `自动生成公文，从${doc.origin}到${doc.destination}，等级：${doc.level}`,
      documentId: doc.id,
      level: 'info'
    });
  }
  res.json(newDocuments);
});

app.get('/api/horses', (req: Request, res: Response) => {
  res.json(horses);
});

app.put('/api/horses/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const index = horses.findIndex(h => h.id === id);
  if (index === -1) {
    res.status(404).json({ error: '马匹不存在' });
    return;
  }
  horses[index] = { ...horses[index], ...req.body };
  logs.push({
    id: generateId(),
    timestamp: new Date(),
    action: `更新马匹${horses[index].name}信息`,
    horseId: id,
    level: 'info'
  });
  res.json(horses[index]);
});

app.post('/api/horses/:id/assign', (req: Request, res: Response) => {
  const { id } = req.params;
  const { documentId } = req.body;
  const horseIndex = horses.findIndex(h => h.id === id);
  const docIndex = documents.findIndex(d => d.id === documentId);

  if (horseIndex === -1) {
    res.status(404).json({ error: '马匹不存在' });
    return;
  }
  if (docIndex === -1) {
    res.status(404).json({ error: '公文不存在' });
    return;
  }
  if (horses[horseIndex].status !== '空闲') {
    res.status(400).json({ error: '马匹不可用' });
    return;
  }

  horses[horseIndex].status = '在役';
  documents[docIndex].assignedHorseId = id;
  documents[docIndex].status = '派送中';
  documents[docIndex].dispatchedAt = new Date();

  logs.push({
    id: generateId(),
    timestamp: new Date(),
    action: `分派马匹${horses[horseIndex].name}运送公文`,
    horseId: id,
    documentId,
    level: 'info'
  });

  res.json({ success: true });
});

app.post('/api/horses/:id/return', (req: Request, res: Response) => {
  const { id } = req.params;
  const index = horses.findIndex(h => h.id === id);
  if (index === -1) {
    res.status(404).json({ error: '马匹不存在' });
    return;
  }

  horses[index].status = '休息中';
  horses[index].stamina = Math.max(0, horses[index].stamina - 20);

  const doc = documents.find(d => d.assignedHorseId === id && d.status === '派送中');
  if (doc) {
    doc.status = '已送达';
    doc.deliveredAt = new Date();
  }

  logs.push({
    id: generateId(),
    timestamp: new Date(),
    action: `马匹${horses[index].name}归还，进入休息状态`,
    horseId: id,
    level: 'info'
  });

  res.json({ success: true });
});

app.get('/api/soldiers', (req: Request, res: Response) => {
  res.json(soldiers);
});

app.post('/api/dispatch', (req: Request, res: Response) => {
  const { documentId, horseId, soldierId } = req.body;
  const doc = documents.find(d => d.id === documentId);
  const horse = horses.find(h => h.id === horseId);
  const soldier = soldiers.find(s => s.id === soldierId);

  if (!doc || !horse || !soldier) {
    res.status(404).json({ error: '资源不存在' });
    return;
  }
  if (horse.status !== '空闲' || soldier.status !== '空闲') {
    res.status(400).json({ error: '资源不可用' });
    return;
  }

  const now = new Date();
  const estimatedHours = doc.level === '步递' ? 4 : doc.level === '马递' ? 2 : 1;
  const dispatch: Dispatch = {
    id: generateId(),
    documentId,
    horseId,
    soldierId,
    startTime: now,
    estimatedArrival: new Date(now.getTime() + estimatedHours * 60 * 60 * 1000),
    status: '进行中'
  };

  dispatches.push(dispatch);
  horse.status = '在役';
  soldier.status = '在役';
  soldier.assignments++;
  doc.status = '派送中';
  doc.dispatchedAt = now;
  doc.assignedHorseId = horseId;
  doc.assignedSoldierId = soldierId;

  logs.push({
    id: generateId(),
    timestamp: now,
    action: `创建调度：${soldier.name}骑乘${horse.name}运送公文从${doc.origin}到${doc.destination}`,
    documentId,
    horseId,
    level: 'info'
  });

  res.json(dispatch);
});

app.get('/api/dispatch/optimize', (req: Request, res: Response) => {
  const recommendations: string[] = [];
  const pendingDocs = documents.filter(d => d.status === '待分拣' || d.status === '已分拣');
  const idleHorses = horses.filter(h => h.status === '空闲');
  const idleSoldiers = soldiers.filter(s => s.status === '空闲');

  if (pendingDocs.length > 0) {
    recommendations.push(`当前有${pendingDocs.length}件公文等待派送`);
  }
  if (idleHorses.length < 2) {
    recommendations.push(`空闲马匹不足，仅剩${idleHorses.length}匹`);
  }
  if (idleSoldiers.length < 2) {
    recommendations.push(`空闲铺兵不足，仅剩${idleSoldiers.length}人`);
  }

  const urgentDocs = documents.filter(d => d.status !== '已送达' && new Date(d.deadline) < new Date());
  if (urgentDocs.length > 0) {
    recommendations.push(`有${urgentDocs.length}件公文已超时，请优先处理`);
  }

  const tiredHorses = horses.filter(h => h.stamina < 50);
  if (tiredHorses.length > 0) {
    recommendations.push(`${tiredHorses.length}匹马力不足，建议安排休息`);
  }

  if (recommendations.length === 0) {
    recommendations.push('当前调度状态良好，资源充足');
  }

  res.json({ recommendations });
});

app.post('/api/dispatch/urgent', (req: Request, res: Response) => {
  const { documentId } = req.body;
  if (urgentCount <= 0) {
    res.status(400).json({ error: '今日加急次数已用完', remainingUrgentCount: 0 });
    return;
  }

  const doc = documents.find(d => d.id === documentId);
  if (!doc) {
    res.status(404).json({ error: '公文不存在', remainingUrgentCount: urgentCount });
    return;
  }

  urgentCount--;
  doc.isUrgent = true;
  doc.level = '急脚递';
  doc.deadline = calculateDeadline('急脚递', new Date());

  logs.push({
    id: generateId(),
    timestamp: new Date(),
    action: `公文加急处理，升级为急脚递`,
    documentId,
    level: 'warning'
  });

  res.json({ success: true, remainingUrgentCount: urgentCount });
});

app.get('/api/logs', (req: Request, res: Response) => {
  const { date, level } = req.query;
  let filteredLogs = [...logs];

  if (date) {
    const targetDate = new Date(date as string);
    filteredLogs = filteredLogs.filter(log => {
      const logDate = new Date(log.timestamp);
      return logDate.toDateString() === targetDate.toDateString();
    });
  }

  if (level) {
    filteredLogs = filteredLogs.filter(log => log.level === level);
  }

  res.json(filteredLogs);
});

app.post('/api/logs', (req: Request, res: Response) => {
  const body = req.body as Partial<LogEntry>;
  const newLog: LogEntry = {
    id: generateId(),
    timestamp: new Date(),
    action: body.action || '未知操作',
    level: body.level || 'info',
    documentId: body.documentId,
    horseId: body.horseId
  };
  logs.push(newLog);
  res.json(newLog);
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
