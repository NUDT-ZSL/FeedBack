import { v4 as uuidv4 } from 'uuid';
import type {
  Event,
  Registration,
  EventWithStats,
  CreateEventRequest,
  RegisterRequest,
  VerifyRequest,
  VerifyResponse,
} from '../shared/types';

interface DataStore {
  events: Record<string, Event>;
  registrations: Record<string, Registration>;
  eventRegistrations: Record<string, string[]>;
}

const store: DataStore = {
  events: {},
  registrations: {},
  eventRegistrations: {},
};

function seedDemoData() {
  const now = Date.now();
  const demoEvents: Event[] = [
    {
      id: uuidv4(),
      name: '2026 前端技术峰会',
      dateTime: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      location: '上海国际会议中心 · 主会场 A',
      maxCapacity: 200,
      description: '汇聚全球顶尖前端工程师，探讨 React 19、Vite 6、边缘计算等前沿技术趋势。现场将有 20+ 场主题演讲及动手实验营。',
      createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: uuidv4(),
      name: '创业者交流晚宴',
      dateTime: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
      location: '北京瑰丽酒店 · 宴会厅',
      maxCapacity: 50,
      description: '面向 A 轮以上创业者的闭门晚宴，与知名投资人、行业领袖面对面交流。仅限受邀报名。',
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: uuidv4(),
      name: 'AI 产品设计工作坊',
      dateTime: new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
      location: '深圳腾讯滨海大厦 · 多功能厅',
      maxCapacity: 30,
      description: '从 0 到 1 学习如何设计一款 AI Native 产品。包含用户研究、Prompt 设计、原型迭代等实战环节。',
      createdAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  demoEvents.forEach((e) => {
    store.events[e.id] = e;
    store.eventRegistrations[e.id] = [];
  });

  const names = ['张明', '李雪', '王磊', '陈静怡', '刘浩然', 'Sarah Wang'];
  const emails = ['zhang@example.com', 'li@example.com', 'wang@example.com', 'chen@example.com', 'liu@example.com', 'sarah@example.com'];
  const eventIds = Object.keys(store.events);
  
  for (let i = 0; i < 4; i++) {
    const eventId = eventIds[0];
    const reg: Registration = {
      id: uuidv4(),
      eventId,
      name: names[i],
      email: emails[i],
      checkedIn: i < 2,
      checkedInAt: i < 2 ? new Date(now - 3600 * 1000 + i * 60000).toISOString() : undefined,
      createdAt: new Date(now - 10 * 60 * 60 * 1000 + i * 30 * 60000).toISOString(),
    };
    store.registrations[reg.id] = reg;
    store.eventRegistrations[eventId].push(reg.id);
  }
}

seedDemoData();

export function addEvent(req: CreateEventRequest): Event {
  const id = uuidv4();
  const event: Event = {
    id,
    name: req.name.trim(),
    dateTime: req.dateTime,
    location: req.location.trim(),
    maxCapacity: Number(req.maxCapacity),
    description: req.description.trim(),
    createdAt: new Date().toISOString(),
  };
  store.events[id] = event;
  store.eventRegistrations[id] = [];
  return event;
}

export function getEvents(): EventWithStats[] {
  const list = Object.values(store.events).map((e) => {
    const count = store.eventRegistrations[e.id]?.length ?? 0;
    return {
      ...e,
      registeredCount: count,
      isFull: count >= e.maxCapacity,
    };
  });
  return list.sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
}

export function getEventById(id: string): EventWithStats | null {
  const e = store.events[id];
  if (!e) return null;
  const count = store.eventRegistrations[id]?.length ?? 0;
  return {
    ...e,
    registeredCount: count,
    isFull: count >= e.maxCapacity,
  };
}

export function register(req: RegisterRequest): Registration | { error: string } {
  const event = store.events[req.eventId];
  if (!event) return { error: '活动不存在' };

  const count = store.eventRegistrations[req.eventId]?.length ?? 0;
  if (count >= event.maxCapacity) return { error: '活动已满员' };

  const id = uuidv4();
  const reg: Registration = {
    id,
    eventId: req.eventId,
    name: req.name.trim(),
    email: req.email.trim(),
    checkedIn: false,
    createdAt: new Date().toISOString(),
  };
  store.registrations[id] = reg;
  if (!store.eventRegistrations[req.eventId]) {
    store.eventRegistrations[req.eventId] = [];
  }
  store.eventRegistrations[req.eventId].push(id);
  return reg;
}

export function getRegistrationById(id: string): Registration | null {
  return store.registrations[id] ?? null;
}

export function getRegistrationsByEvent(eventId: string): Registration[] {
  const ids = store.eventRegistrations[eventId] ?? [];
  return ids.map((id) => store.registrations[id]).filter(Boolean);
}

export function verify(req: VerifyRequest): VerifyResponse {
  const reg = store.registrations[req.registrationId];
  if (!reg) {
    return { success: false, message: '报名ID不存在' };
  }
  if (reg.eventId !== req.eventId) {
    return { success: false, message: '该报名不属于当前活动' };
  }
  if (reg.checkedIn) {
    return { success: false, message: '该参与者已签到', registration: reg };
  }
  reg.checkedIn = true;
  reg.checkedInAt = new Date().toISOString();
  return { success: true, message: '签到成功', registration: reg };
}
